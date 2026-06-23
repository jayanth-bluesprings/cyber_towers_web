using CyberTowers.Bridge.Models;
using CyberTowers.Bridge.Services;
using CyberTowers.Bridge.Workers;

// ── Host builder ───────────────────────────────────────────────────────────────

var host = Host.CreateDefaultBuilder(args)
    .UseWindowsService(opts => opts.ServiceName = "CyberTowers.Bridge")
    .ConfigureAppConfiguration((ctx, config) =>
    {
        config.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
        config.AddJsonFile($"appsettings.{ctx.HostingEnvironment.EnvironmentName}.json",
            optional: true, reloadOnChange: true);
        config.AddEnvironmentVariables(prefix: "BRIDGE_");
        config.AddCommandLine(args);
    })
    .ConfigureServices((ctx, services) =>
    {
        // ── Options ──────────────────────────────────────────────────────────
        services.Configure<BridgeOptions>(ctx.Configuration.GetSection("Bridge"));

        // ── HTTP client for Express API calls ─────────────────────────────────
        services.AddHttpClient<ExpressApiClient>();

        // ── Core services ─────────────────────────────────────────────────────
        services.AddSingleton<DiscoveryService>();
        services.AddSingleton<CardPushService>();

        // ── Main hosted worker ────────────────────────────────────────────────
        services.AddHostedService<BridgeWorker>();

        // ── Logging ───────────────────────────────────────────────────────────
        services.AddLogging(logging =>
        {
            logging.AddConsole();
            logging.AddEventLog(settings =>
            {
                settings.SourceName = "CyberTowers.Bridge";
                settings.LogName    = "Application";
            });
        });
    })
    .Build();

await host.RunAsync();
