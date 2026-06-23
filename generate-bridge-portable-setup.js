/** Generates CyberTowers_Bridge_Portable_Setup.docx — simple step-by-step guide
 *  for setting up the zipped Bridge folder on another laptop and connecting it
 *  to the web application. Written for a non-technical operator. */
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
const bullet=(t,lvl=0)=>new Paragraph({numbering:{reference:'b',level:lvl},spacing:{after:60},children:[new TextRun(t)]});
const step=t=>new Paragraph({numbering:{reference:'s',level:0},spacing:{after:100},children:Array.isArray(t)?t:[new TextRun(t)]});
function code(lines){const a=Array.isArray(lines)?lines:[lines];return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[W],rows:[new TableRow({children:[new TableCell({borders,width:{size:W,type:WidthType.DXA},shading:{fill:'1E1E1E',type:ShadingType.CLEAR},margins:{top:100,bottom:100,left:160,right:160},children:[new Paragraph({children:a.map((l,i)=>new TextRun({text:l,font:'Consolas',size:18,color:'D4D4D4',break:i>0?1:0}))})]})]})]});}
function callout(label,text,color){return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[W],rows:[new TableRow({children:[new TableCell({borders:{top:{style:BorderStyle.SINGLE,size:1,color},left:{style:BorderStyle.SINGLE,size:18,color},bottom:{style:BorderStyle.SINGLE,size:1,color},right:{style:BorderStyle.SINGLE,size:1,color}},width:{size:W,type:WidthType.DXA},shading:{fill:GREY,type:ShadingType.CLEAR},margins:{top:100,bottom:100,left:160,right:160},children:[new Paragraph({children:[new TextRun({text:label+'  ',bold:true,color}),new TextRun({text,size:20})]})]})]})]});}
function table(headers,rows,widths){
  const cols=widths||headers.map(()=>Math.floor(W/headers.length));
  const hr=new TableRow({tableHeader:true,children:headers.map((h,i)=>new TableCell({borders,width:{size:cols[i],type:WidthType.DXA},shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:60,bottom:60,left:120,right:120},children:[new Paragraph({children:[new TextRun({text:h,bold:true,color:'FFFFFF',size:20})]})]}))});
  const br=rows.map((r,ri)=>new TableRow({children:r.map((cell,ci)=>{const txt=Array.isArray(cell)?cell[0]:cell;const col=Array.isArray(cell)?cell[1]:'000000';const b=Array.isArray(cell);return new TableCell({borders,width:{size:cols[ci],type:WidthType.DXA},shading:{fill:ri%2?GREY:'FFFFFF',type:ShadingType.CLEAR},margins:{top:50,bottom:50,left:120,right:120},children:[new Paragraph({children:[new TextRun({text:String(txt),size:19,color:col,bold:b})]})]});})}));
  return new Table({width:{size:W,type:WidthType.DXA},columnWidths:cols,rows:[hr,...br]});
}

const c=[];
// Cover
c.push(
  new Paragraph({spacing:{before:2300},alignment:AlignmentType.CENTER,children:[new TextRun({text:'CyberTowers',bold:true,size:72,color:NAVY})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Bridge — Setup on a New Laptop',bold:true,size:36,color:BLUE})]}),
  new Paragraph({spacing:{before:240},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Simple step-by-step guide',size:30,color:'404040'})]}),
  new Paragraph({spacing:{before:200},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Unzip the Bridge folder, configure it, and connect it to the web application',italics:true,size:21,color:'595959'})]}),
  new Paragraph({spacing:{before:1500},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Bluesprings AI',bold:true,size:22,color:NAVY})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Version 1.0  ·  June 2026',size:20,color:'808080'})]}),
  new Paragraph({children:[new PageBreak()]}),
);
// TOC
c.push(h1('Table of Contents'));
c.push(new TableOfContents('Table of Contents',{hyperlink:true,headingStyleRange:'1-2'}));
c.push(new Paragraph({children:[new PageBreak()]}));

// 0. Read first
c.push(h1('Before You Start (Please Read)'));
c.push(p('This guide is for setting up the Bridge on a NEW laptop using the zip file you received. Follow the steps in order. You do NOT need any programming knowledge.'));
c.push(p('Good news: the Bridge is "ready-to-run". You do NOT need to install .NET, and you do NOT need to install the TimeWatch SDK — everything is already inside the folder.'));
c.push(callout('YOU WILL NEED:','(1) The Bridge zip file. (2) The web application already set up on this laptop or reachable on the network (the dashboard + its database). (3) The database password. (4) About 15 minutes.',BLUE));

// 1. Unzip
c.push(h1('Step 1 — Unzip the Folder'));
c.push(step('Copy the zip file (for example CyberTowers.Bridge.zip) to the new laptop.'));
c.push(step([new TextRun('Right-click it and choose '),new TextRun({text:'Extract All',bold:true}),new TextRun('.')]));
c.push(step([new TextRun('Extract it so the final folder is exactly: ')]));
c.push(code(['E:\\CyberTowers.Bridge']));
c.push(callout('VERY IMPORTANT:','Use the exact path E:\\CyberTowers.Bridge. The start button (Step 4) is set to look there. If that drive/path does not exist on the laptop, see the note at the end of Step 4.',RED));
c.push(p('After extracting, you should see these inside E:\\CyberTowers.Bridge:'));
c.push(bullet('a folder named bin (this holds the program)'));
c.push(bullet('a folder named SDK (the controller files)'));
c.push(bullet('a file named Start-Bridge.bat (the start button)'));

// 2. Check web app
c.push(h1('Step 2 — Make Sure the Web Application Is Running'));
c.push(p('The Bridge needs the web application and its database to be running first. The Bridge alone does nothing without them.'));
c.push(step('Start the web application (double-click "Bluesprings MyAccess.vbs", or however it is started on this laptop).'));
c.push(step('Open a browser and confirm the dashboard opens, usually at:'));
c.push(code(['http://localhost:5000']));
c.push(step('Leave it running.'));
c.push(callout('IF THE WEB APP IS ON A DIFFERENT COMPUTER:','That is fine — just note down that computer\'s IP address. You will use it in Step 3 instead of "localhost"/"127.0.0.1".',AMBER));

// 3. Configure
c.push(h1('Step 3 — Set the Connection Details'));
c.push(p('This is the only file you need to edit. It tells the Bridge where the database and web application are.'));
c.push(step('Open this file with Notepad:'));
c.push(code(['E:\\CyberTowers.Bridge\\bin\\publish\\appsettings.json']));
c.push(step('Find these lines and set the correct values:'));
c.push(code([
  '"BackendApiBaseUrl": "http://localhost:5000",',
  '...',
  '"ConnectionString": "Host=127.0.0.1;Port=5432;Database=cybertowers_access;Username=postgres;Password=YOUR_DB_PASSWORD"',
]));
c.push(step('Replace YOUR_DB_PASSWORD with the real PostgreSQL password.'));
c.push(step('Save the file (File -> Save) and close Notepad.'));
c.push(sp());
c.push(h2('What to put for the addresses'));
c.push(table(['Situation','BackendApiBaseUrl','Host in ConnectionString'],[
  ['Web app + database on THIS laptop','http://localhost:5000','127.0.0.1'],
  ['Web app + database on ANOTHER computer','http://THAT-IP:5000','THAT-IP'],
],[3200,3080,3080]));
c.push(sp());
c.push(callout('TWO RULES THAT MATTER:','(1) In the database line always use 127.0.0.1 (NOT the word "localhost") when it is the same laptop. (2) Do not change any other lines.',RED));

// 4. Start
c.push(h1('Step 4 — Start the Bridge'));
c.push(step([new TextRun('Go to the folder '),new TextRun({text:'E:\\CyberTowers.Bridge',bold:true}),new TextRun('.')]));
c.push(step([new TextRun('Double-click '),new TextRun({text:'Start-Bridge.bat',bold:true}),new TextRun('.')]));
c.push(step('A small black window appears for a few seconds and then closes by itself. That is normal — the Bridge is now running quietly in the background.'));
c.push(sp());
c.push(callout('DO NOT double-click CyberTowers.Bridge.exe directly.','Always use Start-Bridge.bat. Running the .exe directly can show a "Debug Assertion Failed" popup. The .bat avoids it.',AMBER));
c.push(sp());
c.push(h2('If you could not use the E:\\CyberTowers.Bridge path'));
c.push(p('If you had to extract to a different drive or folder, open Start-Bridge.bat with Notepad (right-click -> Edit) and change every "E:\\CyberTowers.Bridge" to the folder where you actually extracted it, then save.'));

// 5. Verify
c.push(h1('Step 5 — Check That It Is Working'));
c.push(p('Open this file with Notepad to see the live status:'));
c.push(code(['E:\\CyberTowers.Bridge\\bin\\publish\\console-out.txt']));
c.push(p('If you see lines like these, the Bridge started correctly:'));
c.push(code([
  'TimeWatch SDK initialised successfully',
  'Loaded N active controller(s) from database',
  'EventProcessorWorker started',
  'ControllerMonitorWorker started - monitoring N controllers',
]));
c.push(p('You can also open the dashboard -> Bridge Monitor tab to see the Bridge status.'));

// 6. Connect controller
c.push(h1('Step 6 — Connect a Controller'));
c.push(p('Now tell the system which physical door controller(s) exist. The Bridge will then connect to them automatically.'));
c.push(step('In the dashboard, go to Configuration -> Controllers -> Add Controller.'));
c.push(step('Enter the controller details: Serial Number, IP Address, TCP port, UDP port, and Password.'));
c.push(step('Click Save.'));
c.push(step('Within about 30 seconds the controller shows as Online in the Controllers tab and in Bridge Monitor.'));
c.push(step('Add cards and click Push / Sync All to send them to the controller. Live scans then appear in the Events tab.'));
c.push(sp());
c.push(callout('CONTROLLER STAYS OFFLINE?','Check the IP address and password are correct, and that the controller is powered on and on the same network as this laptop.',AMBER));

// 7. After restart
c.push(h1('Step 7 — What To Do After a Restart'));
c.push(p('The Bridge does not start by itself after the laptop reboots. Each time the laptop is restarted, do these two simple things:'));
c.push(step('Start the web application (Bluesprings MyAccess.vbs).'));
c.push(step('Double-click E:\\CyberTowers.Bridge\\Start-Bridge.bat.'));
c.push(sp());
c.push(p('That is all. (PostgreSQL starts on its own.)'));
c.push(callout('WANT IT FULLY AUTOMATIC?','The Bridge can be installed as a Windows service so it starts on every boot with no manual step. Ask your technical contact to run the one-time service-install command. After that, you can skip Step 7 for the Bridge.',BLUE));

// 8. Do / Don't
c.push(h1('Important Do’s and Don’ts'));
c.push(table(['Do','Don’t'],[
  ['Keep the whole E:\\CyberTowers.Bridge folder together','Don’t move or delete files from inside bin\\publish'],
  ['Start with Start-Bridge.bat','Don’t double-click CyberTowers.Bridge.exe'],
  ['Edit only appsettings.json','Don’t delete the SDK folder or any .dll files'],
  ['Keep the original SDK zip as a backup','Don’t rename the folder unless you also edit Start-Bridge.bat'],
],[4680,4680]));
c.push(sp());

// 9. Quick checklist
c.push(h1('Quick Checklist'));
c.push(step('Unzip to E:\\CyberTowers.Bridge'));
c.push(step('Web application running (dashboard opens at http://localhost:5000)'));
c.push(step('Edit appsettings.json — set the database password (and addresses if remote)'));
c.push(step('Double-click Start-Bridge.bat'));
c.push(step('Check console-out.txt shows "SDK initialised" and "Worker started"'));
c.push(step('Add the controller in the dashboard and confirm it goes Online'));
c.push(sp());
c.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:400},children:[new TextRun({text:'— End of Guide —',italics:true,color:'808080',size:20})]}));

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
    headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'CyberTowers — Bridge Setup on a New Laptop',size:16,color:'808080'})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Page ',size:16,color:'808080'}),new TextRun({children:[PageNumber.CURRENT],size:16,color:'808080'})]})]})},
    children:c,
  }],
});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync('CyberTowers_Bridge_Portable_Setup.docx',b);console.log('Wrote CyberTowers_Bridge_Portable_Setup.docx ('+(b.length/1024).toFixed(1)+' KB)');});
