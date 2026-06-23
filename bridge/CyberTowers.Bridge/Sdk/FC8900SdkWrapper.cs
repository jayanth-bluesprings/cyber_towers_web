using System.Runtime.InteropServices;
using CyberTowers.Bridge.Models;

namespace CyberTowers.Bridge.Sdk;

/// <summary>
/// Real wrapper around the FC8900 native SDK DLL.
///
/// ┌─────────────────────────────────────────────────────────────────┐
/// │  HOW TO WIRE UP THE REAL DLL                                    │
/// │                                                                 │
/// │  1. Copy FC8900SDK.dll into bridge\CyberTowers.Bridge\Sdk\      │
/// │  2. The csproj already copies it to the output directory.       │
/// │  3. Verify the DLL name in [DllImport("FC8900SDK")] below.      │
/// │  4. Verify each native function name against the SDK header.    │
/// │  5. Build as x86 (already set in csproj — the DLL is 32-bit).   │
/// └─────────────────────────────────────────────────────────────────┘
///
/// Until the DLL is available, set Bridge:UseStubSdk = true in
/// appsettings.json and the FC8900SdkStub will be used instead.
/// </summary>
public sealed class FC8900SdkWrapper : IFC8900Sdk
{
    // ── P/Invoke declarations ─────────────────────────────────────────────────
    // DLL name without extension; Windows will search PATH + current dir.
    private const string DLL = "FC8900SDK";

    // Login returns an integer handle (>= 0 on success, -1 on failure).
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern int FC8900_Login(
        string ip, ushort port, string userName, string password,
        out NativeDeviceInfo deviceInfo);

    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)]
    private static extern bool FC8900_Logout(int handle);

    // ── Card operations ────────────────────────────────────────────────────────

    // WriteCardMain — CONFIRMED SDK method
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern bool FC8900_WriteCardMain(
        int handle, ref NativeCardRecord cardRecord);

    // ReadCardMain — CONFIRMED SDK method
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern bool FC8900_ReadCardMain(
        int handle, string cardNo, out NativeCardRecord cardRecord);

    // DelCardMain — CONFIRMED SDK method
    [DllImport(DLL, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern bool FC8900_DelCardMain(int handle, string cardNo);

    // ── Record retrieval ───────────────────────────────────────────────────────

    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)]
    private static extern int FC8900_GetRecordCount(int handle, int recTypeIndex);

    [DllImport(DLL, CallingConvention = CallingConvention.StdCall)]
    private static extern int FC8900_GetRecord(
        int handle, int recTypeIndex, int startIndex, int count,
        [Out] NativeRecord[] records);

    // ── Native structs ────────────────────────────────────────────────────────

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct NativeDeviceInfo
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string SerialNumber;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string FirmwareVersion;
        public int    DoorCount;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct NativeCardRecord
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string CardNo;
        public int    DoorMask;
        public int    TimeGroup;
        // Dates encoded as yyyyMMdd integers (e.g. 20260101)
        public int    ValidFromInt;
        public int    ValidUntilInt;
        public int    Reserved;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct NativeRecord
    {
        public int    Index;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string CardNo;
        // Time as Unix timestamp (seconds since 1970-01-01 UTC)
        public long   EventTimestamp;
        public int    DoorNum;
        public int    EventCodeInt;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string EventCode;
        public int    DirectionInt; // 0=N/A, 1=In, 2=Out
        public int    AccessResultInt; // 0=Unknown, 1=Granted, 2=Denied, 3=Alarm, 4=System
        public int    IsAlert;
    }

    // ── State ──────────────────────────────────────────────────────────────────
    private int    _handle      = -1;
    private string _controllerSn = "";
    private bool   _disposed;

    // ── IFC8900Sdk implementation ──────────────────────────────────────────────

    public bool   IsConnected   => _handle >= 0;
    public string ControllerSn  => _controllerSn;

    public bool Connect(string ipAddress, int tcpPort, string password)
    {
        if (IsConnected) Disconnect();
        var info = new NativeDeviceInfo();
        _handle = FC8900_Login(ipAddress, (ushort)tcpPort, "admin", password, out info);
        if (_handle < 0) return false;
        _controllerSn = info.SerialNumber?.Trim() ?? "";
        return true;
    }

    public void Disconnect()
    {
        if (_handle >= 0)
        {
            FC8900_Logout(_handle);
            _handle = -1;
        }
    }

    public bool GetDeviceInfo(out DeviceInfo deviceInfo)
    {
        // Device info is captured during Login; return cached values.
        deviceInfo = new DeviceInfo { Sn = _controllerSn };
        return IsConnected;
    }

    // ── CONFIRMED SDK methods ──────────────────────────────────────────────────

    public bool WriteCardMain(string cardNo, int doorMask = 0xFF, int timeGroup = 0,
        DateTime? validFrom = null, DateTime? validUntil = null)
    {
        EnsureConnected();
        var rec = new NativeCardRecord
        {
            CardNo       = cardNo,
            DoorMask     = doorMask,
            TimeGroup    = timeGroup,
            ValidFromInt  = validFrom.HasValue
                ? int.Parse(validFrom.Value.ToString("yyyyMMdd")) : 0,
            ValidUntilInt = validUntil.HasValue
                ? int.Parse(validUntil.Value.ToString("yyyyMMdd")) : 0,
        };
        return FC8900_WriteCardMain(_handle, ref rec);
    }

    public bool ReadCardMain(string cardNo, out CardInfo cardInfo)
    {
        EnsureConnected();
        var ok = FC8900_ReadCardMain(_handle, cardNo, out var raw);
        cardInfo = ok
            ? new CardInfo
            {
                CardNo    = raw.CardNo,
                DoorMask  = raw.DoorMask,
                TimeGroup = raw.TimeGroup,
                ValidFrom  = ParseDateInt(raw.ValidFromInt),
                ValidUntil = ParseDateInt(raw.ValidUntilInt),
                IsValid   = true,
            }
            : new CardInfo { CardNo = cardNo, IsValid = false };
        return ok;
    }

    public bool DelCardMain(string cardNo)
    {
        EnsureConnected();
        return FC8900_DelCardMain(_handle, cardNo);
    }

    // ── Historical record retrieval ────────────────────────────────────────────

    public int GetRecordCount(int recTypeIndex)
    {
        EnsureConnected();
        return FC8900_GetRecordCount(_handle, recTypeIndex);
    }

    public IReadOnlyList<SdkRecord> GetRecords(int recTypeIndex, int startIndex, int count)
    {
        EnsureConnected();
        var buf = new NativeRecord[count];
        int returned = FC8900_GetRecord(_handle, recTypeIndex, startIndex, count, buf);
        var result = new List<SdkRecord>(returned);
        for (int i = 0; i < returned; i++)
        {
            var r = buf[i];
            result.Add(new SdkRecord
            {
                Index        = r.Index,
                CardNo       = r.CardNo ?? "",
                EventTime    = DateTimeOffset.FromUnixTimeSeconds(r.EventTimestamp).UtcDateTime,
                DoorNum      = r.DoorNum,
                EventCodeInt = r.EventCodeInt,
                EventCode    = r.EventCode ?? "",
                Direction    = r.DirectionInt switch { 1 => "In", 2 => "Out", _ => "N/A" },
                AccessResult = r.AccessResultInt switch
                {
                    1 => "Granted", 2 => "Denied", 3 => "Alarm", 4 => "System", _ => "Unknown"
                },
                IsAlert = r.IsAlert != 0,
            });
        }
        return result;
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private void EnsureConnected()
    {
        if (!IsConnected)
            throw new InvalidOperationException("SDK not connected. Call Connect() first.");
    }

    private static DateTime? ParseDateInt(int v)
    {
        if (v <= 0) return null;
        try
        {
            int y = v / 10000, m = (v % 10000) / 100, d = v % 100;
            return new DateTime(y, m, d, 0, 0, 0, DateTimeKind.Utc);
        }
        catch { return null; }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Disconnect();
    }
}
