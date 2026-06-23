using CyberTowers.Bridge.Models;
using Microsoft.Extensions.Options;

namespace CyberTowers.Bridge.Services;

/// <summary>
/// Polls Express for pending card-push jobs and executes them against
/// the appropriate controller sessions using WriteCardMain / ReadCardMain / DelCardMain.
/// </summary>
public sealed class CardPushService
{
    private readonly ExpressApiClient         _api;
    private readonly BridgeOptions            _opts;
    private readonly ILogger<CardPushService> _log;

    // Set by BridgeWorker after controller sessions are initialized.
    public IReadOnlyDictionary<string, ControllerSession> Sessions { get; set; }
        = new Dictionary<string, ControllerSession>();

    public CardPushService(ExpressApiClient api, IOptions<BridgeOptions> opts,
        ILogger<CardPushService> log)
    {
        _api  = api;
        _opts = opts.Value;
        _log  = log;
    }

    // ── Poll cycle ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Fetch pending push jobs from Express, execute against controllers, report results.
    /// </summary>
    public async Task PollAndPushAsync(CancellationToken ct)
    {
        var pending = await _api.GetPendingPushAsync(ct);
        if (pending == null || pending.Cards.Count == 0) return;

        _log.LogInformation("Card push poll: {Count} pending job(s)", pending.Cards.Count);

        foreach (var card in pending.Cards)
        {
            if (ct.IsCancellationRequested) break;
            await ProcessCardAsync(card, ct);
        }
    }

    // ── Per-card processing ────────────────────────────────────────────────────

    private async Task ProcessCardAsync(PendingCard card, CancellationToken ct)
    {
        // Push to all online controllers. In a future version this could be scoped
        // to the card's access group → specific controllers.
        var targets = Sessions.Values.Where(s => s.IsOnline).ToList();

        if (targets.Count == 0)
        {
            _log.LogWarning("No online controllers — skipping card {CardNo}", card.CardNo);
            await _api.ReportCardPushResultAsync(new CardPushResultDto
            {
                CardId       = card.Id,
                CardNo       = card.CardNo,
                ControllerSn = "",
                Success      = false,
                ErrorMessage = "No online controllers",
            }, ct);
            return;
        }

        foreach (var session in targets)
        {
            if (ct.IsCancellationRequested) break;
            await PushToControllerWithRetryAsync(card, session, ct);
        }
    }

    // ── Push with retry ────────────────────────────────────────────────────────

    private async Task PushToControllerWithRetryAsync(PendingCard card,
        ControllerSession session, CancellationToken ct)
    {
        int       attempts = 0;
        Exception? lastEx  = null;

        while (attempts < _opts.CardPushMaxRetries && !ct.IsCancellationRequested)
        {
            attempts++;
            try
            {
                // 1. WriteCardMain
                bool written = await session.WriteCardAsync(card, ct);
                if (!written)
                {
                    _log.LogWarning("WriteCardMain failed for {CardNo} on {Sn} (attempt {A}/{Max})",
                        card.CardNo, session.Sn, attempts, _opts.CardPushMaxRetries);
                    await DelayRetryAsync(attempts, ct);
                    continue;
                }

                // 2. ReadCardMain — verify
                bool verified = await session.VerifyCardAsync(card.CardNo, ct);

                // 3. Report success
                await _api.ReportCardPushResultAsync(new CardPushResultDto
                {
                    CardId         = card.Id,
                    CardNo         = card.CardNo,
                    ControllerSn   = session.Sn,
                    Success        = true,
                    Attempts       = attempts,
                    VerifiedByRead = verified,
                }, ct);

                _log.LogInformation("Pushed {CardNo} to {Sn} ok (verified={V})",
                    card.CardNo, session.Sn, verified);
                return;
            }
            catch (Exception ex)
            {
                lastEx = ex;
                _log.LogWarning(ex, "Push exception for {CardNo} on {Sn} (attempt {A})",
                    card.CardNo, session.Sn, attempts);
                await DelayRetryAsync(attempts, ct);
            }
        }

        // All retries exhausted
        await _api.ReportCardPushResultAsync(new CardPushResultDto
        {
            CardId       = card.Id,
            CardNo       = card.CardNo,
            ControllerSn = session.Sn,
            Success      = false,
            Attempts     = attempts,
            ErrorMessage = lastEx?.Message ?? "Max retries exceeded",
        }, ct);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private async Task DelayRetryAsync(int attempt, CancellationToken ct)
    {
        var delay = TimeSpan.FromSeconds(_opts.CardPushRetryBaseSeconds * attempt);
        _log.LogDebug("Retry delay {Delay}s before next attempt", delay.TotalSeconds);
        try { await Task.Delay(delay, ct); }
        catch (OperationCanceledException) { }
    }
}
