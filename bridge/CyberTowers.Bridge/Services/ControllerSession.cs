using CyberTowers.Bridge.Models;
using CyberTowers.Bridge.Sdk;
using Microsoft.Extensions.Options;

namespace CyberTowers.Bridge.Services;

/// <summary>
/// Manages the lifecycle of one SDK connection to a single FC8900 controller.
/// Handles connect/reconnect, heartbeat, historical event sync, and card push.
/// One ControllerSession instance is created per known controller.
/// </summary>
public sealed class ControllerSession : IDisposable
{
    private readonly ControllerRecord          _ctrl;
    private readonly IFC8900Sdk                _sdk;
    private readonly ExpressApiClient          _api;
    private readonly BridgeOptions             _opts;
    private readonly ILogger<ControllerSession> _log;

    // Last record index synced per recTypeIndex so we don't re-send known records.
    private readonly Dictionary<int, int> _lastSyncedIndex = new()
    {
        [0] = 0, // Normal
        [1] = 0, // Card
        [2] = 0, // Alarm
    };

    private int  _consecutiveFailures;
    private bool _disposed;
    private Task? _liveMonitorTask;
    private int  _lastLiveIndex = 0;

    public string           Sn         => _ctrl.Sn;
    public bool             IsOnline   => _sdk.IsConnected;
    public ControllerRecord Controller => _ctrl;

    public ControllerSession(ControllerRecord ctrl, IFC8900Sdk sdk,
        ExpressApiClient api, IOptions<BridgeOptions> opts,
        ILogger<ControllerSession> log)
    {
        _ctrl = ctrl;
        _sdk  = sdk;
        _api  = api;
        _opts = opts.Value;
        _log  = log;
    }

    // ── Connection ─────────────────────────────────────────────────────────────

    public async Task<bool> EnsureConnectedAsync(CancellationToken ct)
    {
        if (_sdk.IsConnected) return true;
        return await ConnectAsync(ct);
    }

    public async Task<bool> ConnectAsync(CancellationToken ct)
    {
        _log.LogInformation("Connecting to controller {Sn} @ {Ip}:{Port}",
            _ctrl.Sn, _ctrl.IpAddress, _ctrl.TcpPort);
        try
        {
            var ok = await Task.Run(
                () => _sdk.Connect(_ctrl.IpAddress, _ctrl.TcpPort, _ctrl.PasswordEncrypted),
                ct);

            if (ok)
            {
                _consecutiveFailures = 0;
                _log.LogInformation("Connected to controller {Sn}", _ctrl.Sn);
                await ReportStatusAsync(true, ct);
            }
            else
            {
                _consecutiveFailures++;
                _log.LogWarning("Connection failed to controller {Sn} (failures={N})",
                    _ctrl.Sn, _consecutiveFailures);
                await ReportStatusAsync(false, ct);
            }
            return ok;
        }
        catch (Exception ex)
        {
            _consecutiveFailures++;
            _log.LogWarning(ex, "Exception connecting to controller {Sn}", _ctrl.Sn);
            await ReportStatusAsync(false, ct);
            return false;
        }
    }

    // ── Heartbeat ──────────────────────────────────────────────────────────────

    public async Task HeartbeatAsync(CancellationToken ct)
    {
        if (!_sdk.IsConnected)
        {
            await ConnectAsync(ct);
            return;
        }
        try
        {
            await Task.Run(() => _sdk.GetDeviceInfo(out _), ct);
            _consecutiveFailures = 0;
            await ReportStatusAsync(true, ct);
        }
        catch (Exception ex)
        {
            _consecutiveFailures++;
            _log.LogWarning(ex, "Heartbeat failed for controller {Sn} (failures={N})",
                _ctrl.Sn, _consecutiveFailures);
            _sdk.Disconnect();
            await ReportStatusAsync(false, ct);
        }
    }

    // ── Live event monitoring ──────────────────────────────────────────────────

    /// <summary>
    /// Start a background task that polls for new events every 2 seconds
    /// and immediately POSTs them to Express.
    /// </summary>
    public void StartLiveMonitoring(CancellationToken ct)
    {
        if (_liveMonitorTask != null && !_liveMonitorTask.IsCompleted) return;

        _liveMonitorTask = Task.Run(async () =>
        {
            _log.LogInformation("Live event monitoring started for {Sn}", _ctrl.Sn);
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    if (!await EnsureConnectedAsync(ct))
                    {
                        await Task.Delay(5000, ct);
                        continue;
                    }

                    int total = await Task.Run(() => _sdk.GetRecordCount(0), ct);
                    if (total > _lastLiveIndex)
                    {
                        int count = total - _lastLiveIndex;
                        var records = await Task.Run(
                            () => _sdk.GetRecords(0, _lastLiveIndex, count), ct);

                        foreach (var r in records)
                        {
                            var evt = MapRecord(r, 0);
                            await _api.PostEventAsync(evt, ct);
                            _lastLiveIndex++;
                        }

                        if (records.Count > 0)
                            _log.LogInformation("Synced {Count} live events from {Sn}",
                                records.Count, _ctrl.Sn);
                    }

                    await Task.Delay(2000, ct);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Live monitoring error for {Sn}", _ctrl.Sn);
                    await Task.Delay(5000, ct);
                }
            }
            _log.LogInformation("Live event monitoring stopped for {Sn}", _ctrl.Sn);
        }, ct);
    }

    public void StopLiveMonitoring()
    {
        // No-op; cancellation is handled by the passed CancellationToken
    }

    // ── Card push (exposed for CardPushService) ────────────────────────────────

    /// <summary>
    /// Write a card using WriteCardMain. Returns false if SDK call fails.
    /// </summary>
    public Task<bool> WriteCardAsync(PendingCard card, CancellationToken ct) =>
        Task.Run(() =>
        {
            if (!_sdk.IsConnected) return false;
            return _sdk.WriteCardMain(
                card.CardNo,
                doorMask:   0xFF,   // all doors
                timeGroup:  0,      // always
                validFrom:  card.ValidFrom,
                validUntil: card.ValidUntil);
        }, ct);

    /// <summary>
    /// Verify the card was written with ReadCardMain. Returns true if found on controller.
    /// </summary>
    public Task<bool> VerifyCardAsync(string cardNo, CancellationToken ct) =>
        Task.Run(() =>
        {
            if (!_sdk.IsConnected) return false;
            return _sdk.ReadCardMain(cardNo, out _);
        }, ct);

    /// <summary>
    /// Delete a card using DelCardMain.
    /// </summary>
    public Task<bool> DeleteCardAsync(string cardNo, CancellationToken ct) =>
        Task.Run(() =>
        {
            if (!_sdk.IsConnected) return false;
            return _sdk.DelCardMain(cardNo);
        }, ct);

    // ── Historical sync ────────────────────────────────────────────────────────

    /// <summary>
    /// Fetch new records from the controller and POST them to Express as a batch.
    /// Uses lastSyncedIndex to avoid re-sending records already posted.
    /// </summary>
    public async Task SyncHistoricalAsync(CancellationToken ct)
    {
        if (!await EnsureConnectedAsync(ct)) return;

        const int PageSize = 50;
        foreach (var recType in _lastSyncedIndex.Keys.ToList())
        {
            try
            {
                int total = await Task.Run(() => _sdk.GetRecordCount(recType), ct);
                int from  = _lastSyncedIndex[recType];
                if (total <= from) continue;

                _log.LogInformation(
                    "Syncing controller {Sn} recType={T}: {From}→{Total}",
                    _ctrl.Sn, recType, from, total);

                while (from < total && !ct.IsCancellationRequested)
                {
                    int take    = Math.Min(PageSize, total - from);
                    var records = await Task.Run(
                        () => _sdk.GetRecords(recType, from, take), ct);

                    if (records.Count == 0) break;

                    var batch = new EventBatchDto
                    {
                        ControllerSn = _ctrl.Sn,
                        Events       = records.Select(r => MapRecord(r, recType)).ToList(),
                    };

                    await _api.PostEventBatchAsync(batch, ct);
                    from += records.Count;
                    _lastSyncedIndex[recType] = from;
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Historical sync error for controller {Sn} recType={T}",
                    _ctrl.Sn, recType);
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private async Task ReportStatusAsync(bool online, CancellationToken ct)
    {
        await _api.ReportControllerStatusAsync(new ControllerStatusDto
        {
            Sn                  = _ctrl.Sn,
            IsOnline            = online,
            LastHeartbeatAt     = DateTime.UtcNow,
            ConsecutiveFailures = _consecutiveFailures,
            UpdatedAt           = DateTime.UtcNow,
        }, ct);
    }

    private EventIngestDto MapRecord(SdkRecord r, int recTypeIndex) => new()
    {
        ControllerSn  = _ctrl.Sn,
        CardNo        = r.CardNo,
        EventDate     = r.EventTime,
        DoorNum       = r.DoorNum,
        Direction     = r.Direction,
        RecordType    = RecTypeName(recTypeIndex),
        EventCode     = r.EventCode,
        EventCodeInt  = r.EventCodeInt,
        AccessResult  = r.AccessResult,
        IsAlert       = r.IsAlert,
        AlertSeverity = r.IsAlert ? "Medium" : null,
        Source        = "Sync",
    };

    private static string RecTypeName(int i) => i switch
    {
        0 => "Normal",
        1 => "Card",
        2 => "Alarm",
        3 => "DoorOpen",
        4 => "DoorClose",
        5 => "AlarmRecord",
        _ => "Unknown",
    };

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _sdk.Disconnect(); } catch { /* ignore */ }
        _sdk.Dispose();
    }
}
