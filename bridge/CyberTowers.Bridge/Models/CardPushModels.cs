namespace CyberTowers.Bridge.Models;

// ── Pending-push response from GET /internal/bridge/cards/pending-push ────────

public sealed class PendingPushResponse
{
    public bool                  Ok          { get; set; }
    public List<PendingCard>     Cards       { get; set; } = new();
    public List<ControllerRecord> Controllers { get; set; } = new();
}

public sealed class PendingCard
{
    public string   Id           { get; set; } = "";
    public string   CardNo       { get; set; } = "";
    public string?  PersonName   { get; set; }
    public string?  PersonCode   { get; set; }
    public string   CardType     { get; set; } = "Normal";
    public string   CardStatus   { get; set; } = "Active";
    public string?  AccessGroupId{ get; set; }
    public DateTime? ValidFrom   { get; set; }
    public DateTime? ValidUntil  { get; set; }
    public string   PushStatus   { get; set; } = "Pending";
}

// ── Card info returned by ReadCardMain (verify step) ─────────────────────────

public sealed class CardInfo
{
    public string   CardNo     { get; set; } = "";
    public int      DoorMask   { get; set; }
    public int      TimeGroup  { get; set; }
    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidUntil{ get; set; }
    public bool     IsValid    { get; set; }
}

// ── Push result reported to POST /internal/bridge/cards/push ─────────────────

public sealed class CardPushResultDto
{
    public string?  PushLogId      { get; set; }
    public string   CardId         { get; set; } = "";
    public string   CardNo         { get; set; } = "";
    public string   ControllerSn   { get; set; } = "";
    public bool     Success        { get; set; }
    public int      Attempts       { get; set; } = 1;
    public bool     VerifiedByRead { get; set; }
    public string?  ErrorMessage   { get; set; }
}

// ── Remove result reported to DELETE /internal/bridge/cards/remove ───────────

public sealed class CardRemoveResultDto
{
    public string?  PushLogId    { get; set; }
    public string   CardId       { get; set; } = "";
    public string   CardNo       { get; set; } = "";
    public string   ControllerSn { get; set; } = "";
    public bool     Success      { get; set; }
    public int      Attempts     { get; set; } = 1;
    public string?  ErrorMessage { get; set; }
}

// ── Controller status heartbeat ───────────────────────────────────────────────

public sealed class ControllerStatusDto
{
    public string   Sn                   { get; set; } = "";
    public bool     IsOnline             { get; set; }
    public DateTime LastHeartbeatAt      { get; set; } = DateTime.UtcNow;
    public int      ConsecutiveFailures  { get; set; }
    public DateTime UpdatedAt            { get; set; } = DateTime.UtcNow;
}

// ── DeviceInfo returned by GetDeviceInfo() ────────────────────────────────────

public sealed class DeviceInfo
{
    public string Sn           { get; set; } = "";
    public string FirmwareVersion { get; set; } = "";
    public int    DoorCount    { get; set; } = 1;
}
