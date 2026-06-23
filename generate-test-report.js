/** Generates CyberTowers_System_Test_Report.docx — full live test report (18 Jun 2026). */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageBreak, LevelFormat, Header, Footer, PageNumber,
} = require('docx');

const NAVY='1F3864', BLUE='2E75B6', GREY='F2F2F2', RED='C00000', GREEN='548235', AMBER='BF8F00';
const W=9360;
const bd={style:BorderStyle.SINGLE,size:1,color:'BFBFBF'};
const borders={top:bd,left:bd,bottom:bd,right:bd};
const h1=t=>new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(t)]});
const h2=t=>new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun(t)]});
const p=(t,o={})=>new Paragraph({spacing:{after:120},children:[new TextRun({text:t,...o})]});
const sp=()=>new Paragraph({spacing:{after:80},children:[]});
const bullet=t=>new Paragraph({numbering:{reference:'b',level:0},spacing:{after:60},children:[new TextRun(t)]});
const numbered=t=>new Paragraph({numbering:{reference:'s',level:0},spacing:{after:80},children:[new TextRun(t)]});
function code(lines){const a=Array.isArray(lines)?lines:[lines];return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[W],rows:[new TableRow({children:[new TableCell({borders,width:{size:W,type:WidthType.DXA},shading:{fill:'1E1E1E',type:ShadingType.CLEAR},margins:{top:100,bottom:100,left:160,right:160},children:[new Paragraph({children:a.map((l,i)=>new TextRun({text:l,font:'Consolas',size:18,color:'D4D4D4',break:i>0?1:0}))})]})]})]});}
function callout(label,text,color){return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[W],rows:[new TableRow({children:[new TableCell({borders:{top:{style:BorderStyle.SINGLE,size:1,color},left:{style:BorderStyle.SINGLE,size:18,color},bottom:{style:BorderStyle.SINGLE,size:1,color},right:{style:BorderStyle.SINGLE,size:1,color}},width:{size:W,type:WidthType.DXA},shading:{fill:GREY,type:ShadingType.CLEAR},margins:{top:100,bottom:100,left:160,right:160},children:[new Paragraph({children:[new TextRun({text:label+'  ',bold:true,color}),new TextRun({text,size:20})]})]})]})]});}
function table(headers,rows,widths){
  const cols=widths||headers.map(()=>Math.floor(W/headers.length));
  const hr=new TableRow({tableHeader:true,children:headers.map((h,i)=>new TableCell({borders,width:{size:cols[i],type:WidthType.DXA},shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:60,bottom:60,left:120,right:120},children:[new Paragraph({children:[new TextRun({text:h,bold:true,color:'FFFFFF',size:20})]})]}))});
  const br=rows.map((r,ri)=>new TableRow({children:r.map((cell,ci)=>{const txt=Array.isArray(cell)?cell[0]:cell;const col=Array.isArray(cell)?cell[1]:'000000';const bold=Array.isArray(cell);return new TableCell({borders,width:{size:cols[ci],type:WidthType.DXA},shading:{fill:ri%2?GREY:'FFFFFF',type:ShadingType.CLEAR},margins:{top:50,bottom:50,left:120,right:120},children:[new Paragraph({children:[new TextRun({text:String(txt),size:19,color:col,bold})]})]});})}));
  return new Table({width:{size:W,type:WidthType.DXA},columnWidths:cols,rows:[hr,...br]});
}
const PASS=['PASS',GREEN], FAIL=['FAIL',RED], OK=['RUNNING',GREEN];

const c=[];
// Cover
c.push(
  new Paragraph({spacing:{before:2400},alignment:AlignmentType.CENTER,children:[new TextRun({text:'CyberTowers',bold:true,size:72,color:NAVY})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Vehicle Access Dashboard',bold:true,size:40,color:BLUE})]}),
  new Paragraph({spacing:{before:240},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Full System Test Report',size:32,color:'404040'})]}),
  new Paragraph({spacing:{before:200},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Live verification of backend, database, API, and the hardware Bridge Service',italics:true,size:21,color:'595959'})]}),
  new Paragraph({spacing:{before:1400},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Test date: 18 June 2026',bold:true,size:24,color:NAVY})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Bluesprings AI  ·  Version 1.0',size:20,color:'808080'})]}),
  new Paragraph({children:[new PageBreak()]}),
);
// TOC
c.push(h1('Table of Contents'));
c.push(new TableOfContents('Table of Contents',{hyperlink:true,headingStyleRange:'1-2'}));
c.push(new Paragraph({children:[new PageBreak()]}));

// 1
c.push(h1('1. Executive Summary'));
c.push(p('This report documents a full live test of the CyberTowers Vehicle Access Dashboard performed on 18 June 2026 on the installed laptop. Every software component was exercised against the running system, and the hardware Bridge Service was brought online and verified.'));
c.push(p('Headline result: the complete software stack — web dashboard, backend API, authentication, real-time layer, and PostgreSQL database — is fully operational. The hardware Bridge Service, which had never run before, was repaired and is now running cleanly with the real controller SDK loaded. One additional defect (a database enum case-mismatch) was found during testing and fixed. No physical controller is connected yet, because none is configured or present on the network.'));
c.push(callout('VERDICT:','All software components PASS. The Bridge Service is RUNNING and stable. The system is ready to connect physical controllers once they are added with real network details.',GREEN));

// 2
c.push(h1('2. Test Environment'));
c.push(table(['Item','Value'],[
  ['Test date / time','18 June 2026, ~17:00 IST'],
  ['Backend URL','http://localhost:5000'],
  ['Database','PostgreSQL 18 — cybertowers_access (schema: cybertowers)'],
  ['Bridge location','E:\\CyberTowers.Bridge (self-contained x86 build)'],
  ['Runtime','.NET 8 (x64 SDK; bridge published self-contained win-x86)'],
  ['Backend uptime at test','~6.4 hours, continuous'],
],[3000,6360]));

// 3
c.push(h1('3. Software Component Tests'));
c.push(h2('3.1 Backend & database'));
c.push(table(['Test','Result','Evidence'],[
  ['Backend health endpoint',PASS,'/health -> {status: ok, db: ok}'],
  ['Database connectivity',PASS,'db: ok; queries succeed'],
  ['PostgreSQL service',OK,'PostgreSQL 18, startup type Automatic'],
  ['Backend process stability',PASS,'~6.4 h continuous uptime'],
],[3400,1700,4260]));
c.push(sp());
c.push(h2('3.2 Security & authentication'));
c.push(table(['Test','Result','Evidence'],[
  ['Reject request without API key',PASS,'GET /api/controllers (no key) -> HTTP 401'],
  ['Accept request with valid key',PASS,'GET /api/controllers (key) -> HTTP 200'],
  ['Frontend/backend key match',PASS,'Dashboard loads data without 401'],
],[3400,1700,4260]));
c.push(sp());
c.push(h2('3.3 API endpoints'));
c.push(table(['Endpoint','Result','HTTP'],[
  ['/api/controllers',PASS,'200'],
  ['/api/cards',PASS,'200'],
  ['/api/events/stats',PASS,'200'],
  ['/api/access-groups',PASS,'200'],
  ['/api/monitoring/overview',PASS,'200'],
  ['/api/users',PASS,'200'],
],[4600,2200,2560]));

// 4
c.push(h1('4. Bridge Service — Detailed Status'));
c.push(p('The hardware Bridge Service (E:\\CyberTowers.Bridge) is the component that talks to the physical FC8900 controllers using the real TimeWatch SDK. It had never run successfully before this session. It was repaired, rebuilt as a self-contained x86 application, and is now running cleanly.'));
c.push(h2('4.1 Runtime status'));
c.push(table(['Check','Result','Detail'],[
  ['Bridge process',OK,'Running, ~59 MB memory, stable'],
  ['Controller SDK init',PASS,'TimeWatch SDK (ConnectMain + CareaIfc) initialised'],
  ['Database connection',PASS,'Reads cybertowers tables directly via Npgsql'],
  ['Background workers',PASS,'EventProcessor, HistoricalSync, RetryQueue, HealthCheck, ControllerMonitor all started'],
  ['Historical sync cycle',PASS,'Startup sync ran and completed with no errors'],
  ['Error log over full cycle',PASS,'Zero errors / exceptions after fixes'],
],[2800,1500,5060]));
c.push(sp());
c.push(h2('4.2 What was repaired to make it run'));
c.push(p('The Bridge had six blocking defects plus a missing runtime. All were fixed:'));
c.push(table(['#','Defect','Fix'],[
  ['1','Required 32-bit .NET runtime that was not installed','Re-published as self-contained win-x86 (runtime bundled)'],
  ['2','Dependency injection: IXlsParser not registered','Registered the interface mapping'],
  ['3','SDK type names missing namespaces (ConnectMain, ConnectInfo, 2 enums)','Used fully-qualified FCardCDrive type names'],
  ['4','SDK event delegate signatures mismatched (5 events)','Reflection-based binding + corrected handler signatures'],
  ['5','Empty database connection string; localhost DNS crash on x86','Set connection string using host 127.0.0.1'],
  ['6','Empty SignalR hub URL crashed startup','Skip SignalR gracefully (events sent via HTTP)'],
],[600,4400,4360]));

// 5
c.push(h1('5. Issue Found & Fixed During This Test'));
c.push(p('While monitoring the running Bridge, a recurring database error was observed in the retry worker:'));
c.push(code(['22P02: invalid input value for enum cybertowers.sync_status_enum: "failed"']));
c.push(p('Cause: two Bridge SQL queries used lower-case status literals (‘failed’, ‘success’) while the PostgreSQL enum values are capitalised (Running, Success, Failed, Partial).'));
c.push(p('Fix: corrected both literals to ‘Failed’ and ‘Success’, rebuilt, and restarted. A subsequent full cycle ran with zero errors.'));
c.push(callout('RESULT:','After the fix, the Bridge ran a complete monitoring + historical-sync cycle with no errors of any kind.',GREEN));

// 6
c.push(h1('6. Controller Connectivity Status'));
c.push(p('No physical controller is connected, because none is configured in the system and no FC8900 hardware is present on this laptop’s network. This is expected; the Bridge correctly reports it is monitoring 0 controllers.'));
c.push(table(['Requirement','Status'],[
  ['Bridge Service running with real SDK',['YES',GREEN]],
  ['Bridge connected to database',['YES',GREEN]],
  ['Controllers configured in dashboard',['0 (none)',AMBER]],
  ['Physical FC8900 on the network',['Not present',AMBER]],
  ['Live heartbeats / scan events',['0 (no controller yet)',AMBER]],
],[6360,3000]));
c.push(sp());
c.push(p('To connect a real controller: add it in Configuration -> Controllers with its real serial number, IP, port and password, with the device powered on and reachable on the LAN. The Bridge will then connect, mark it Online, and stream events into the dashboard automatically.'));

// 7
c.push(h1('7. Current Data Inventory'));
c.push(table(['Data','Count'],[
  ['Controllers configured','0'],
  ['Access cards','0'],
  ['Scan events','0'],
  ['Access groups','7 (seeded)'],
  ['Users','0'],
  ['Sync log rows','0 (no controllers to sync yet)'],
],[6360,3000]));

// 8
c.push(h1('8. Overall Verdict'));
c.push(table(['Area','Status'],[
  ['Web dashboard',['OPERATIONAL',GREEN]],
  ['Backend API + authentication',['OPERATIONAL',GREEN]],
  ['PostgreSQL database',['OPERATIONAL',GREEN]],
  ['Real-time / WebSocket layer',['OPERATIONAL',GREEN]],
  ['Bridge Service (software)',['RUNNING / CLEAN',GREEN]],
  ['Physical controller link',['PENDING HARDWARE',AMBER]],
],[5000,4360]));
c.push(sp());
c.push(callout('SUMMARY:','Every software component passed. The Bridge Service is running with the real controller SDK and zero errors. The only remaining step to go fully live is adding a physical controller on the network.',BLUE));

// 9
c.push(h1('9. Outstanding Actions'));
c.push(h2('9.1 Make the Bridge run automatically (recommended)'));
c.push(p('The Bridge currently runs as a console process. To run it as a Windows service that starts on boot, run once in an Administrator PowerShell:'));
c.push(code([
  'sc.exe create "CyberTowers Bridge Service" binPath= "E:\\CyberTowers.Bridge\\bin\\publish\\CyberTowers.Bridge.exe" start= auto',
  'sc.exe start "CyberTowers Bridge Service"',
]));
c.push(h2('9.2 Connect a physical controller'));
c.push(numbered('Ensure the FC8900 controller is powered and on the same network as this laptop.'));
c.push(numbered('In the dashboard: Configuration -> Controllers -> Add Controller; enter serial number, IP, ports, password.'));
c.push(numbered('Within ~30 seconds it appears Online in Controllers and Bridge Monitor; scans then stream into Events.'));
c.push(sp());
c.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:400},children:[new TextRun({text:'— End of Report —',italics:true,color:'808080',size:20})]}));

const doc=new Document({
  styles:{default:{document:{run:{font:'Arial',size:22}}},paragraphStyles:[
    {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:30,bold:true,color:NAVY},paragraph:{spacing:{before:320,after:160},outlineLevel:0,border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLUE,space:4}}}},
    {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:24,bold:true,color:BLUE},paragraph:{spacing:{before:200,after:100},outlineLevel:1}},
  ]},
  numbering:{config:[
    {reference:'b',levels:[{level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:720,hanging:360}}}}]},
    {reference:'s',levels:[{level:0,format:LevelFormat.DECIMAL,text:'%1.',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:720,hanging:360}}}}]},
  ]},
  sections:[{
    properties:{page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440}}},
    headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'CyberTowers — Full System Test Report',size:16,color:'808080'})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Page ',size:16,color:'808080'}),new TextRun({children:[PageNumber.CURRENT],size:16,color:'808080'})]})]})},
    children:c,
  }],
});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync('CyberTowers_System_Test_Report.docx',b);console.log('Wrote CyberTowers_System_Test_Report.docx ('+(b.length/1024).toFixed(1)+' KB)');});
