using CyberTowers.Bridge.Models;
using CyberTowers.Bridge.Sdk;
using CyberTowers.Bridge.Services;
using Microsoft.Extensions.Options;

namespace CyberTowers.Bridge.Workers;

/// <summary>
/// Main hosted worker service.
/// Orchestrates: discovery, controller sessions, heartbeat, historical sync, card push.
///
/// Timer schedule (all configurable via appsettings Bridge section):
///   - UDP discovery:        every DiscoveryIntervalSeconds (default 60s)
///   - Heartbeat:            every HeartbeatIntervalSeconds (default 30s)
///   - Card push poll:       every CardPushPollIntervalSeconds (default 10s)
///   - Historical sync:      every HistoricalSyncIntervalMinutes (default 60m)
/// </summary>
public sealed class BridgeWorker : BackgroundService
{
    private readonly BridgeOptions          _opts;
    private readonly ExpressApiClient       _api;
    private readonly DiscoveryService       _discovery;
    private readonly CardPushService        _cardPush;
    private readonly IServiceProvider       _sp;
    private readonly ILogger<BridgeWorker>  _log;

    // SN → active session
    private readonly Dictionary<string, ControllerSession> _sessions = new();

    private DateTime _lastDiscovery    = DateTime.MinValue;
    private DateTime _lastHeartbeat    = DateTime.MinValue;
    private DateTime _lastCardPollTime = DateTime.MinValue;
    private DateTime _lastHistSync     = DateTime.MinValue;

    public BridgeWorker(
        IOptions<BridgeOptions>  opts,
        ExpressApiClient         api,
        DiscoveryService         discovery,
        CardPushService          cardPush,
        IServiceProvider         sp,
        ILogger<BridgeWorker>    log)
    {
        _opts      = opts.Value;
        _api       = api;
        _discovery = discovery;
        _cardPush  = cardPush;
        _sp        = sp;
        _log       = log;
    }

    // ── Main loop ──────────────────────────────────────────────────────────────

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("CyberTowers Bridge starting (UseStubSdk={Stub})",
            _opts.UseStubSdk);

        // Load known controllers from Express before first discovery cycle.
        await RefreshControllersFromExpressAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var now = DateTime.UtcNow;

            // ── UDP discovery ────────────────────────────────────────────────
            if ((now - _lastDiscovery).TotalSeconds >= _opts.DiscoveryIntervalSeconds)
            {
                _lastDiscovery = now;
                try { await _discovery.DiscoverAsync(stoppingToken); }
                catch (Exception ex)
                { _log.LogWarning(ex, "Discovery cycle error"); }

                // Refresh sessions after discovery (new controllers may have been added)
                await RefreshControllersFromExpressAsync(stoppingToken);
            }

            // ── Heartbeat ────────────────────────────────────────────────────
            if ((now - _lastHeartbeat).TotalSeconds >= _opts.HeartbeatIntervalSeconds)
            {
                _lastHeartbeat = now;
                foreach (var session in _sessions.Values)
                    _ = Task.Run(() => session.HeartbeatAsync(stoppingToken), stoppingToken);
            }

            // ── Card push poll ───────────────────────────────────────────────
            if ((now - _lastCardPollTime).TotalSeconds >= _opts.CardPushPollIntervalSeconds)
            {
                _lastCardPollTime = now;
                _cardPush.Sessions = _sessions;
                try { await _cardPush.PollAndPushAsync(stoppingToken); }
                catch (Exception ex)
                { _log.LogWarning(ex, "Card push poll error"); }
            }

            // ── Historical sync ──────────────────────────────────────────────
            if ((now - _lastHistSync).TotalMinutes >= _opts.HistoricalSyncIntervalMinutes)
            {
                _lastHistSync = now;
                foreach (var session in _sessions.Values)
                    _ = Task.Run(() => session.SyncHistoricalAsync(stoppingToken), stoppingToken);
            }

            // Sleep 1 second between ticks (fine-grained enough, avoids busy-spin).
            try { await Task.Delay(1000, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        // Graceful shutdown
        _log.LogInformation("Bridge worker stopping — disposing {N} sessions", _sessions.Count);
        foreach (var s in _sessions.Values) s.Dispose();
        _sessions.Clear();
    }

    // ── Session management ─────────────────────────────────────────────────────

    private async Task RefreshControllersFromExpressAsync(CancellationToken ct)
    {
        var controllers = await _api.GetControllersAsync(ct);
        _log.LogInformation("Express returned {N} controller(s)", controllers.Count);

        foreach (var ctrl in controllers)
        {
            if (string.IsNullOrWhiteSpace(ctrl.Sn)) continue;
            if (_sessions.ContainsKey(ctrl.Sn))     continue; // already have a session

            var session = CreateSession(ctrl, ct);
            _sessions[ctrl.Sn] = session;

            // Connect in the background so startup isn't blocked by slow hardware.
            _ = Task.Run(() => session.ConnectAsync(ct), ct);
        }
    }

    private ControllerSession CreateSession(ControllerRecord ctrl, CancellationToken ct)
    {
        IFC8900Sdk sdk = _opts.UseStubSdk
            ? new Sdk.FC8900SdkStub(_sp.GetRequiredService<ILogger<Sdk.FC8900SdkStub>>())
            : new Sdk.FC8900SdkWrapper();

        var session = new ControllerSession(
            ctrl, sdk, _api,
            _sp.GetRequiredService<IOptions<BridgeOptions>>(),
            _sp.GetRequiredService<ILogger<ControllerSession>>());

        // Start live event monitoring in background
        session.StartLiveMonitoring(ct);

        return session;
    }
}
