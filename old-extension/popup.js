document.addEventListener('DOMContentLoaded', () => {
    const btnStart = document.getElementById('btnStart');
    const btnStop = document.getElementById('btnStop');
    const btnExport = document.getElementById('btnExport');
    const btnClear = document.getElementById('btnClear');
    const statusText = document.getElementById('status');
    const recordCount = document.getElementById('recordCount');

    // อัปเดตจำนวนรายการที่บันทึกไว้
    function updateCount() {
        chrome.storage.local.get(['windLog'], (result) => {
            const logs = result.windLog || [];
            recordCount.innerText = logs.length;
        });
    }

    // ถาม Content Script ว่ากำลังทำงานอยู่ไหม
    function checkStatus() {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if(tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {action: "STATUS"}, (response) => {
                    if (chrome.runtime.lastError) return; // ดัก Error กรณีเว็บยังไม่โหลด
                    if (response && response.isRunning) {
                        btnStart.style.display = 'none';
                        btnStop.style.display = 'block';
                        statusText.innerText = "กำลังทำงาน...";
                        statusText.style.color = "#4CAF50";
                    }
                });
            }
        });
    }

    btnStart.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {action: "START"}, () => {
                btnStart.style.display = 'none';
                btnStop.style.display = 'block';
                statusText.innerText = "กำลังทำงาน...";
                statusText.style.color = "#4CAF50";
            });
        });
    });

    btnStop.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {action: "STOP"}, () => {
                btnStart.style.display = 'block';
                btnStop.style.display = 'none';
                statusText.innerText = "หยุดทำงาน";
                statusText.style.color = "#f44336";
            });
        });
    });

    btnExport.addEventListener('click', () => {
        chrome.storage.local.get(['windLog'], (result) => {
            const logs = result.windLog || [];
            if (logs.length === 0) {
                alert("ยังไม่มีข้อมูลให้ Export ครับ");
                return;
            }

            // สร้าง CSV Header
            let csvContent = "Timestamp,Event_Name,Degree,Direction,Speed_kts\n";
            
            // เติมข้อมูล
            logs.forEach(row => {
                csvContent += `"${row.timestamp}","${row.event}",${row.degree},"${row.direction}",${row.speed}\n`;
            });

            // สั่งดาวน์โหลด
            const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); // \uFEFF รองรับภาษาไทยใน Excel
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `SailFish_WindData_${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    });

    btnClear.addEventListener('click', () => {
        if (confirm("คุณต้องการลบข้อมูลที่บันทึกไว้ทั้งหมดใช่หรือไม่?")) {
            chrome.storage.local.set({ windLog: [] }, () => {
                updateCount();
            });
        }
    });

    // โหลดข้อมูลครั้งแรกที่เปิด Popup
    updateCount();
    checkStatus();
    
    // อัปเดตตัวเลขโชว์แบบ Real-time ทุก 2 วิ
    setInterval(updateCount, 2000);
});