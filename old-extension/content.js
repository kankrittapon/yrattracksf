const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc14MlUT-C9bShbXl0J73PYKx7W-2I2FQNayel_PpqQ05GyRQ/formResponse";

const ENTRY_IDS = {
    event: "entry.1974872684",   
    degree: "entry.2055697047",  
    speed: "entry.902240096"     
};

let trackerInterval = null;

function scrapeWindData() {
    const compass = document.querySelector('[data-compassvalue]');
    if (!compass) {
        console.warn("[SailTracker] ไม่พบข้อมูลลม (data-compassvalue) บนหน้าจอ");
        return;
    }

    const raw = compass.getAttribute('data-compassvalue').split('#');
    const deg = parseFloat(raw[0]);
    const speed = parseFloat(raw[1]);

    if (isNaN(deg) || isNaN(speed)) return;

    const dirs = ["เหนือ (N)", "ตะวันออกเฉียงเหนือ (NE)", "ตะวันออก (E)", "ตะวันออกเฉียงใต้ (SE)", "ใต้ (S)", "ตะวันตกเฉียงใต้ (SW)", "ตะวันตก (W)", "ตะวันตกเฉียงเหนือ (NW)"];
    const dirName = dirs[Math.round(deg / 45) % 8];
    const fullDirection = `${dirName} (${deg}°)`;

    const eventName = document.title.replace(/,/g, ' '); 

    // 🌟 ท่าไม้ตาย: สร้าง Iframe ซ่อนไว้ เพื่อรับผลลัพธ์การส่งฟอร์ม (หน้าเว็บจะได้ไม่เด้งเปลี่ยนหน้า)
    let iframe = document.getElementById('hidden_iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.name = 'hidden_iframe';
        iframe.id = 'hidden_iframe';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
    }

    // 🌟 สร้างฟอร์ม HTML จำลองขึ้นมาในหน่วยความจำ
    const form = document.createElement('form');
    form.action = FORM_URL;
    form.method = 'POST';
    form.target = 'hidden_iframe'; // สั่งให้ส่งข้อมูลทะลุไปที่ iframe ซ่อน
    form.style.display = 'none';

    // 🌟 สร้างช่องกรอกข้อมูลและยัดค่าใส่ลงไป
    const inputEvent = document.createElement('input');
    inputEvent.name = ENTRY_IDS.event;
    inputEvent.value = eventName;
    form.appendChild(inputEvent);

    const inputDeg = document.createElement('input');
    inputDeg.name = ENTRY_IDS.degree;
    inputDeg.value = fullDirection;
    form.appendChild(inputDeg);

    const inputSpeed = document.createElement('input');
    inputSpeed.name = ENTRY_IDS.speed;
    inputSpeed.value = speed;
    form.appendChild(inputSpeed);

    // 🌟 เอาฟอร์มแปะลงเว็บ -> สั่งกดปุ่ม Submit -> แล้วลบทิ้งทันทีแบบไร้ร่องรอย
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);

    console.log(`[SailTracker] ✅ แอบส่งฟอร์มจำลองสำเร็จ: ${fullDirection} | ${speed} kts`);
    
    // บันทึกลง Storage
    chrome.storage.local.get(['windLog'], (result) => {
        let logs = result.windLog || [];
        const now = new Date();
        const timeStr = now.toLocaleDateString('th-TH') + ' ' + now.toLocaleTimeString('th-TH');
        
        logs.push({
            timestamp: timeStr, 
            event: eventName, 
            degree: deg, 
            direction: dirName, 
            speed: speed
        });
        chrome.storage.local.set({ windLog: logs });
    });
}

// -----------------------------------------
// ส่วนรับคำสั่งจาก Popup เหมือนเดิม
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START") {
        if (!trackerInterval) {
            console.log("[SailTracker] ▶ เริ่มการดักจับข้อมูลลมทุก 30 วินาที");
            scrapeWindData(); 
            trackerInterval = setInterval(scrapeWindData, 30000); 
        }
        sendResponse({ status: "running" });
    } else if (request.action === "STOP") {
        if (trackerInterval) {
            clearInterval(trackerInterval);
            trackerInterval = null;
            console.log("[SailTracker] ■ หยุดการดักจับข้อมูลลม");
        }
        sendResponse({ status: "stopped" });
    } else if (request.action === "STATUS") {
        sendResponse({ isRunning: !!trackerInterval });
    }
    return true; 
});