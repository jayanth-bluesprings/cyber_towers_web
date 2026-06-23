using System.Net.Http.Json;
using CyberTowers.Bridge.Models;
using Microsoft.Extensions.Options;

namespace CyberTowers.Bridge.Services;

/// <summary>
/// Typed HTTP client for all calls from Bridge → Express backend.
/// All endpoints are on /internal/bridge/* (localhost, no auth required).
/// </summary>
public sealed class ExpressApiClient
{
    private readonly HttpClient              _http;
    private readonly ILogger<ExpressApiClient> _log;

    public ExpressApiClient(HttpClient http, IOptions<BridgeOptions> opts,
        ILogger<ExpressApiClient> log)
    {
        _http = http;
        _log  = log;
        _http.BaseAddress = new Uri(opts.Value.ExpressBaseUrl.TrimEnd('/') + "/");
        _http.Timeout     = TimeSpan.FromSeconds(10);
    }

    // ── Controllers ────────────────────────────────────────────────────────────

    public async Task<List<ControllerRecord>> GetControllersAsync(CancellationToken ct = default)
    {
        try
        {
            var list = await _http.GetFromJsonAsync<List<ControllerRecord>>(
                "internal/bridge/controllers", ct);
            return list ?? new();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to fetch controllers from Express");
            return new();
        }
    }

    public async Task<bool> ReportDiscoveredAsync(DiscoveredControllerDto dto,
        CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("internal/bridge/controllers/discovered", dto, ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to report discovered controller {Sn}", dto.Sn);
            return false;
        }
    }

    // ── Controller status heartbeat ────────────────────────────────────────────

    public async Task<bool> ReportControllerStatusAsync(ControllerStatusDto dto,
        CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("internal/bridge/controllers/status", dto, ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to post status for controller {Sn}", dto.Sn);
            return false;
        }
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    public async Task<bool> PostEventAsync(EventIngestDto evt, CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("internal/bridge/events", evt, ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to post event for card {CardNo}", evt.CardNo);
            return false;
        }
    }

    public async Task<bool> PostEventBatchAsync(EventBatchDto batch, CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("internal/bridge/events/batch", batch, ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to post event batch ({Count} events) for {Sn}",
                batch.Events.Count, batch.ControllerSn);
            return false;
        }
    }

    // ── Sync log ───────────────────────────────────────────────────────────────

    public async Task<bool> PostSyncAsync(object syncPayload, CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("internal/bridge/sync", syncPayload, ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to post sync record");
            return false;
        }
    }

    // ── Card push ──────────────────────────────────────────────────────────────

    public async Task<PendingPushResponse?> GetPendingPushAsync(CancellationToken ct = default)
    {
        try
        {
            return await _http.GetFromJsonAsync<PendingPushResponse>(
                "internal/bridge/cards/pending-push", ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to fetch pending push queue");
            return null;
        }
    }

    public async Task<bool> ReportCardPushResultAsync(CardPushResultDto dto,
        CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.PostAsJsonAsync("internal/bridge/cards/push", dto, ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to report push result for card {CardId}", dto.CardId);
            return false;
        }
    }

    public async Task<bool> ReportCardRemoveResultAsync(CardRemoveResultDto dto,
        CancellationToken ct = default)
    {
        try
        {
            var resp = await _http.DeleteAsync(
                $"internal/bridge/cards/remove?cardId={dto.CardId}&controllerSn={dto.ControllerSn}&success={dto.Success}",
                ct);
            // Prefer POST body when Express side is updated; fallback query-string is fine for now
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to report remove result for card {CardId}", dto.CardId);
            return false;
        }
    }
}
