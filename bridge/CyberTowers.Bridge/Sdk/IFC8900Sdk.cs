using CyberTowers.Bridge.Models;

namespace CyberTowers.Bridge.Sdk;

/// <summary>
/// Abstraction over the FC8900 hardware SDK.
/// One instance per physical controller.
///
/// CONFIRMED SDK methods (from SDK analysis):
///   WriteCardMain  — write a card record to the controller
///   ReadCardMain   — read back a card record for verification
///   DelCardMain    — delete a card record from the controller
///
/// All other methods follow standard FC8900 SDK patterns.
/// </summary>
public interface IFC8900Sdk : IDisposable
{
    // ── Connection ───────────────────────────────────────────────────────────

    /// <summary>
    /// Connect and authenticate to the controller.
    /// Returns true on success.
    /// </summary>
    bool Connect(string ipAddress, int tcpPort, string password);

    void Disconnect();

    bool IsConnected { get; }

    /// <summary>Controller serial number — populated after Connect().</summary>
    string ControllerSn { get; }

    // ── Device info ──────────────────────────────────────────────────────────

    bool GetDeviceInfo(out DeviceInfo deviceInfo);

    // ── Card operations (CONFIRMED SDK methods) ──────────────────────────────

    /// <summary>
    /// Write a card to the controller's internal database.
    /// CONFIRMED SDK method: WriteCardMain()
    ///
    /// doorMask  — bitmask of doors to grant (door 1 = bit 0, door 2 = bit 1, …)
    /// timeGroup — time-group index (0 = always)
    /// validFrom / validUntil — null means unlimited
    /// </summary>
    bool WriteCardMain(
        string    cardNo,
        int       doorMask   = 0xFF,
        int       timeGroup  = 0,
        DateTime? validFrom  = null,
        DateTime? validUntil = null);

    /// <summary>
    /// Read back a card record from the controller to verify it was written.
    /// CONFIRMED SDK method: ReadCardMain()
    /// Returns false if the card is not found.
    /// </summary>
    bool ReadCardMain(string cardNo, out CardInfo cardInfo);

    /// <summary>
    /// Delete a card from the controller's internal database.
    /// CONFIRMED SDK method: DelCardMain()
    /// </summary>
    bool DelCardMain(string cardNo);

    // ── Historical record retrieval ──────────────────────────────────────────

    /// <summary>
    /// Return total number of stored records for a given type index.
    /// recTypeIndex: 0=Normal, 1=Card, 2=Alarm, 3=DoorOpen, 4=DoorClose, 5=AlarmRecord
    /// </summary>
    int GetRecordCount(int recTypeIndex);

    /// <summary>
    /// Retrieve a page of historical records.
    /// </summary>
    IReadOnlyList<SdkRecord> GetRecords(int recTypeIndex, int startIndex, int count);
}
