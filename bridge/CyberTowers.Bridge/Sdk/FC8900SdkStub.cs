using CyberTowers.Bridge.Models;

namespace CyberTowers.Bridge.Sdk;

/// <summary>
/// In-memory stub used when Bridge:UseStubSdk = true.
/// Simulates FC8900 behavior so the service can be developed and tested
/// without the physical DLL or hardware.
/// </summary>
public sealed class FC8900SdkStub : IFC8900Sdk
{
    private readonly Dictionary<string, CardInfo>  _cards   = new();
    private readonly List<SdkRecord>               _records = new();
    private readonly ILogger<FC8900SdkStub>        _log;

    private bool   _connected;
    private string _sn = "";

    public FC8900SdkStub(ILogger<FC8900SdkStub> log) => _log = log;

    public bool   IsConnected  => _connected;
    public string ControllerSn => _sn;

    public bool Connect(string ipAddress, int tcpPort, string password)
    {
        _connected = true;
        _sn = $"STUB-{ipAddress.Replace('.', '-')}";
        _log.LogInformation("[STUB] Connected to {Ip}:{Port} → SN={Sn}", ipAddress, tcpPort, _sn);

        // Seed some fake historical records
        SeedRecords();
        return true;
    }

    public void Disconnect()
    {
        _connected = false;
        _log.LogInformation("[STUB] Disconnected from {Sn}", _sn);
    }

    public bool GetDeviceInfo(out DeviceInfo deviceInfo)
    {
        deviceInfo = new DeviceInfo { Sn = _sn, FirmwareVersion = "1.0.STUB", DoorCount = 2 };
        return _connected;
    }

    public bool WriteCardMain(string cardNo, int doorMask = 0xFF, int timeGroup = 0,
        DateTime? validFrom = null, DateTime? validUntil = null)
    {
        EnsureConnected();
        _cards[cardNo] = new CardInfo
        {
            CardNo    = cardNo,
            DoorMask  = doorMask,
            TimeGroup = timeGroup,
            ValidFrom  = validFrom,
            ValidUntil = validUntil,
            IsValid   = true,
        };
        _log.LogInformation("[STUB] WriteCardMain({CardNo}) → ok", cardNo);
        return true;
    }

    public bool ReadCardMain(string cardNo, out CardInfo cardInfo)
    {
        EnsureConnected();
        var found = _cards.TryGetValue(cardNo, out var ci);
        cardInfo = found ? ci! : new CardInfo { CardNo = cardNo, IsValid = false };
        _log.LogInformation("[STUB] ReadCardMain({CardNo}) → found={Found}", cardNo, found);
        return found;
    }

    public bool DelCardMain(string cardNo)
    {
        EnsureConnected();
        var removed = _cards.Remove(cardNo);
        _log.LogInformation("[STUB] DelCardMain({CardNo}) → removed={Removed}", cardNo, removed);
        return removed;
    }

    public int GetRecordCount(int recTypeIndex)
    {
        EnsureConnected();
        return _records.Count(r => r.EventCodeInt == recTypeIndex || recTypeIndex == 0);
    }

    public IReadOnlyList<SdkRecord> GetRecords(int recTypeIndex, int startIndex, int count)
    {
        EnsureConnected();
        var filtered = recTypeIndex == 0
            ? _records
            : _records.Where(r => r.EventCodeInt == recTypeIndex).ToList();
        return filtered.Skip(startIndex).Take(count).ToList();
    }

    public void Dispose() { /* nothing to release */ }

    // ── Seed helpers ──────────────────────────────────────────────────────────

    private void SeedRecords()
    {
        _records.Clear();
        var rnd = new Random(42);
        var cards = new[] { "0001234567", "0009876543", "0005551234" };
        var results = new[] { "Granted", "Denied", "Granted", "Granted", "Alarm" };
        for (int i = 0; i < 30; i++)
        {
            _records.Add(new SdkRecord
            {
                Index        = i,
                CardNo       = cards[rnd.Next(cards.Length)],
                EventTime    = DateTime.UtcNow.AddMinutes(-rnd.Next(1, 2880)),
                DoorNum      = rnd.Next(1, 3),
                EventCodeInt = 1,
                EventCode    = "CardAccess",
                Direction    = rnd.Next(2) == 0 ? "In" : "Out",
                AccessResult = results[rnd.Next(results.Length)],
                IsAlert      = rnd.Next(10) == 0,
            });
        }
        _log.LogInformation("[STUB] Seeded {Count} historical records", _records.Count);
    }

    private void EnsureConnected()
    {
        if (!_connected)
            throw new InvalidOperationException("[STUB] Not connected. Call Connect() first.");
    }
}
