namespace CyberTowers.Bridge.Models;

/// <summary>
/// Single scan event posted to POST /internal/bridge/events.
/// Field names match what scanEventsRepo.insertEvent() expects (camelCase JSON).
/// </summary>
public sealed class EventIngestDto
{
    public string    ControllerSn  { get; set; } = "";
    public string    CardNo        { get; set; } = "";
    public DateTime  EventDate     { get; set; } = DateTime.UtcNow;
    public int       DoorNum       { get; set; } = 1;
    public string    Direction     { get; set; } = "N/A"; // "In" | "Out" | "N/A"
    public string    RecordType    { get; set; } = "";
    public string    EventCode     { get; set; } = "";
    public int?      EventCodeInt  { get; set; }
    public string    AccessResult  { get; set; } = "Unknown"; // "Granted" | "Denied" | "Alarm" | "System" | "Unknown"
    public string?   DenialReason  { get; set; }
    public bool      IsAlert       { get; set; } = false;
    public string?   AlertSeverity { get; set; }            // "Critical" | "High" | "Medium" | "Low"
    public string    Source        { get; set; } = "Live";  // "Live" | "Sync"
}

/// <summary>Payload for POST /internal/bridge/events/batch.</summary>
public sealed class EventBatchDto
{
    public string              ControllerSn { get; set; } = "";
    public List<EventIngestDto> Events      { get; set; } = new();
}

/// <summary>SDK raw record returned by GetRecords().</summary>
public sealed class SdkRecord
{
    public int      Index        { get; set; }
    public string   CardNo       { get; set; } = "";
    public DateTime EventTime    { get; set; }
    public int      DoorNum      { get; set; } = 1;
    public int      EventCodeInt { get; set; }
    public string   EventCode    { get; set; } = "";
    public string   Direction    { get; set; } = "N/A";
    public string   AccessResult { get; set; } = "Unknown";
    public bool     IsAlert      { get; set; }
}
