// ==========================================
// GBASE BACKEND SYSTEM (All-in-One)
// Updated: Delete Photo from Drive Feature
// ==========================================

var IMAGE_FOLDER_ID = "1i4qq9znUEXwbzQrMCKEelLLoY2aYRXhA"; 
var THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// ==========================================
// 1. ROUTER
// ==========================================
function doGet(e) {
  var param = (e && e.parameter) ? e.parameter.get : null;
  if (param === 'data') return getDebtDataFull();
  if (param === 'fitnessData' || param === 'gallery') return getFitnessData();
  if (param === 'settings') return getSettings();
  return responseJSON({ status: 'online', message: "System Ready" });
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = JSON.parse(e.postData.contents);
  var action = data.action;

  try {
    if (action === 'addTransaction') return addTransaction(data, ss);
    if (action === 'saveBatch') return saveBatch(data, ss);
    if (action === 'updatePayment') return updatePayment(data, ss);
    if (action === 'payBatch') return payBatch(data, ss);
    if (action === 'deleteBatchTransaction') return deleteBatchTransaction(data, ss);
    
    if (action === 'addIncome') return addIncome(data, ss);
    if (action === 'deleteBatchIncome') return deleteBatchIncome(data, ss);
    
    if (action === 'addCard') return addCard(data, ss);
    if (action === 'updateCardLimit') return updateCardLimit(data, ss);
    if (action === 'deleteCard') return deleteCard(data, ss);

    // รวม Action ของ Fitness ทั้งหมด (เพิ่ม deletePhoto แล้ว)
    if (['uploadPhoto', 'saveWeight', 'deleteWeight', 'deletePhoto'].indexOf(action) > -1) {
      return handleFitnessPost(action, data, ss);
    } 

    if (action === 'saveSettings') return saveSettings(data, ss);

    return responseJSON({ status: 'error', message: 'Unknown Action' });

  } catch (err) {
    return responseJSON({ status: 'error', message: err.toString() });
  }
}

// ==========================================
// 2. FITNESS SERVICE (Iron Log)
// ==========================================
function handleFitnessPost(action, data, ss) {
  var sheetW = ensureSheetExists(ss, "Weight", ["Date", "Weight"]);
  var sheetG = ensureSheetExists(ss, "Gallery", ["Date", "ImageURL", "FileID", "Weight"]);

  if (action === 'saveWeight') {
    var allData = sheetW.getDataRange().getValues(); var rowIndex = -1;
    for (var i = 1; i < allData.length; i++) { if (new Date(allData[i][0]).toDateString() === new Date(data.date).toDateString()) { rowIndex = i + 1; break; } }
    var val = parseFloat(data.weight).toFixed(2);
    if (rowIndex > -1) sheetW.getRange(rowIndex, 2).setValue(val); else sheetW.appendRow([data.date, val]);
    if (sheetW.getLastRow() > 1) sheetW.getRange(2, 1, sheetW.getLastRow()-1, 2).sort({column: 1, ascending: false});
    return responseJSON({ status: 'success' });
  }

  if (action === 'uploadPhoto') {
    var folder = DriveApp.getFolderById(IMAGE_FOLDER_ID);
    var bytes = Utilities.base64Decode(data.image.substr(data.image.indexOf('base64,') + 7));
    var blob = Utilities.newBlob(bytes, data.image.substring(5, data.image.indexOf(';')), "img_" + Date.now() + ".jpg");
    var file = folder.createFile(blob); file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);
    var url = "https://drive.google.com/uc?export=view&id=" + file.getId();
    sheetG.appendRow([data.date, url, file.getId(), data.weight || ""]);
    return responseJSON({ status: 'success', url: url });
  }

  if (action === 'deleteWeight') {
    var allData = sheetW.getDataRange().getValues();
    for (var i = 1; i < allData.length; i++) { if (new Date(allData[i][0]).toDateString() === new Date(data.date).toDateString()) { sheetW.deleteRow(i + 1); break; } }
    return responseJSON({ status: 'success' });
  }

  // 🟢 ฟังก์ชันลบรูป (ลบใน Sheet + ลบไฟล์ใน Drive)
  if (action === 'deletePhoto') {
    var allData = sheetG.getDataRange().getValues();
    for (var i = 1; i < allData.length; i++) {
       // เทียบ FileID (Column 3)
       if (String(allData[i][2]) === String(data.fileId)) { 
         sheetG.deleteRow(i + 1); // ลบจาก Sheet
         try { 
           DriveApp.getFileById(data.fileId).setTrashed(true); // ย้ายไฟล์ลงถังขยะ Drive
         } catch(e) {
           // กรณีหาไฟล์ไม่เจอ (อาจจะลบไปแล้ว) ก็ให้ปล่อยผ่าน
         }
         break; 
       }
    }
    return responseJSON({ status: 'success' });
  }
}

function getFitnessData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetG = ss.getSheetByName("Gallery"); var sheetW = ss.getSheetByName("Weight");
  var gallery = (sheetG && sheetG.getLastRow() > 1) ? sheetG.getDataRange().getValues().slice(1).map(function(r) { return { date: r[0], url: r[1], fileId: r[2], weight: r[3] }; }).reverse() : [];
  var weights = (sheetW && sheetW.getLastRow() > 1) ? sheetW.getDataRange().getValues().slice(1).map(function(r) { return { date: r[0], value: r[1] }; }) : [];
  weights.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
  return responseJSON({ gallery: gallery, weights: weights });
}

// ==========================================
// 3. DEBT MANAGER SERVICE
// ==========================================
function getDebtDataFull() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Transactions
  var sheetTrans = ss.getSheetByName("Transactions");
  var transactions = [];
  if (sheetTrans && sheetTrans.getLastRow() > 1) {
    transactions = sheetTrans.getDataRange().getValues().slice(1).map(function(r, i) {
      var m = (r[0] instanceof Date) ? r[0].getFullYear() + "-" + (String(r[0].getMonth()+1).padStart(2,'0')) : String(r[0]).substring(0,7);
      var pm = r[6] ? ((r[6] instanceof Date) ? r[6].getFullYear() + "-" + (String(r[6].getMonth()+1).padStart(2,'0')) : String(r[6]).substring(0,7)) : m;
      
      var rawDue = r[5]; var dueDisplay = rawDue;
      if (rawDue && (typeof rawDue === 'number' || (typeof rawDue === 'string' && rawDue.match(/^\d+$/)))) {
         if (pm && pm.includes('-')) {
             var monthIndex = parseInt(pm.split('-')[1], 10) - 1;
             if (THAI_MONTHS_SHORT[monthIndex]) { dueDisplay = rawDue + " " + THAI_MONTHS_SHORT[monthIndex]; }
         }
      }
      return { rowIndex: i + 2, month: m, card: r[1], total: r[2], paid: r[3], minPay: r[4], dueDate: dueDisplay, payMonth: pm };
    });
  }

  // Income
  var sheetInc = ss.getSheetByName("Income");
  var income = [];
  if (sheetInc && sheetInc.getLastRow() > 1) {
    income = sheetInc.getDataRange().getValues().slice(1).map(function(r, i) {
      var m = (r[0] instanceof Date) ? r[0].getFullYear() + "-" + (String(r[0].getMonth()+1).padStart(2,'0')) : String(r[0]).substring(0,7);
      var rawDate = r[3] || r[0]; var fdDisplay = rawDate;
      try {
        if (rawDate instanceof Date) { fdDisplay = rawDate.getDate() + " " + THAI_MONTHS_SHORT[rawDate.getMonth()] + " " + (rawDate.getFullYear() + 543); } 
        else if (typeof rawDate === 'string' && rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
           var parts = rawDate.split('-'); var d = parseInt(parts[2], 10); var mIdx = parseInt(parts[1], 10) - 1; var y = parseInt(parts[0], 10) + 543;
           if (THAI_MONTHS_SHORT[mIdx]) { fdDisplay = d + " " + THAI_MONTHS_SHORT[mIdx] + " " + y; }
        }
      } catch(e) { fdDisplay = rawDate; }
      return { rowIndex: i + 2, month: m, type: r[1], amount: r[2], fullDate: fdDisplay };
    });
  }

  // Cards
  var sheetCard = ss.getSheetByName("Cards");
  var cards = [];
  if (sheetCard && sheetCard.getLastRow() > 1) {
    cards = sheetCard.getDataRange().getValues().slice(1).map(function(r) { return { name: r[0], limit: r[1], used: r[2], remaining: r[3], lastUpdate: r[4] }; });
  }

  // History
  var history = {};
  income.forEach(function(inc) { var k = inc.month; if (!history[k]) history[k] = { inc: 0, bill: 0, paid: 0 }; history[k].inc += parseFloat(inc.amount || 0); });
  transactions.forEach(function(t) { 
      var k = t.month; if (!history[k]) history[k] = { inc: 0, bill: 0, paid: 0 }; 
      var bill = parseFloat(t.total || 0); 
      var actualPaid = parseFloat(t.paid || 0); 
      var effectivePaid = (actualPaid > bill) ? bill : actualPaid; 
      history[k].bill += bill; 
      history[k].paid += effectivePaid; 
  });

  return responseJSON({ transactions: transactions, income: income, cards: cards, history: history });
}

// --- Utils & Actions ---
function addTransaction(d, ss) { var s=ensureSheetExists(ss,"Transactions",["Month","Card","Total","Paid","MinPay","DueDate","PayMonth"]); s.appendRow([d.month,d.card,d.total,0,d.minPay,d.dueDate,d.payMonth]); return responseJSON({status:'success'}); }
function saveBatch(d, ss) { var s=ensureSheetExists(ss,"Transactions",["Month","Card","Total","Paid","MinPay","DueDate","PayMonth"]); d.items.forEach(i=>s.appendRow([i.month,i.card,i.total,0,i.minPay,i.dueDate,i.payMonth])); return responseJSON({status:'success'}); }
function updatePayment(d, ss) { var s=ss.getSheetByName("Transactions"); s.getRange(d.rowIndex,4).setValue(d.paid); return responseJSON({status:'success'}); }
function payBatch(d, ss) { var s=ss.getSheetByName("Transactions"); d.items.forEach(i=>s.getRange(i.rowIndex,4).setValue(i.paid)); return responseJSON({status:'success'}); }
function deleteBatchTransaction(d, ss) { var s=ss.getSheetByName("Transactions"); d.rowIndices.sort((a,b)=>b-a).forEach(r=>{if(r>1)s.deleteRow(r)}); return responseJSON({status:'success'}); }
function addIncome(d, ss) { var s=ensureSheetExists(ss,"Income",["Month","Type","Amount","FullDate"]); s.appendRow([d.month,d.type,d.amount,d.month]); return responseJSON({status:'success'}); }
function deleteBatchIncome(d, ss) { var s=ss.getSheetByName("Income"); d.rowIndices.sort((a,b)=>b-a).forEach(r=>{if(r>1)s.deleteRow(r)}); return responseJSON({status:'success'}); }
function addCard(d, ss) { var s=ensureSheetExists(ss,"Cards",["Name","Limit","Used","Remaining","LastUpdate"]); s.appendRow([d.cardName,d.limit,d.used,d.remaining,d.lastUpdate]); return responseJSON({status:'success'}); }
function updateCardLimit(d, ss) { var s=ss.getSheetByName("Cards"); var dd=s.getDataRange().getValues(); for(var i=1;i<dd.length;i++){if(dd[i][0]==d.oldCardName){s.getRange(i+1,1,1,5).setValues([[d.cardName,d.limit,d.used,d.remaining,d.lastUpdate]]);break;}} return responseJSON({status:'success'}); }
function deleteCard(d, ss) { var s=ss.getSheetByName("Cards"); var dd=s.getDataRange().getValues(); for(var i=1;i<dd.length;i++){if(dd[i][0]==d.cardName){s.deleteRow(i+1);break;}} return responseJSON({status:'success'}); }
function getSettings() { var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings"); var o={}; if(s)s.getDataRange().getValues().slice(1).forEach(r=>{o[r[0]]=r[1]}); return responseJSON(o); }
function saveSettings(d, ss) { var s=ensureSheetExists(ss,"Settings",["Key","Value"]); var dd=d.settings; var ad=s.getDataRange().getValues(); for(var k in dd){var f=false;for(var i=1;i<ad.length;i++){if(ad[i][0]==k){s.getRange(i+1,2).setValue(dd[k]);f=true;break;}}if(!f)s.appendRow([k,dd[k]]);} return responseJSON({status:'success'}); }
function ensureSheetExists(ss,n,h){var s=ss.getSheetByName(n);if(!s){s=ss.insertSheet(n);s.appendRow(h);}return s;}
function responseJSON(d){return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);}
