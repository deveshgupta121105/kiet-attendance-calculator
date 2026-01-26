// REPLACE THIS URL WITH YOUR GOOGLE APPS SCRIPT URL
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzAzOQZTMwO9hzdG8ZhPa10tko-FEgdDbGpYzuXHkk_rgQKW9WpT8AYAC7IPv45Buo/exec';

function calculateClassesNeeded(attended, total, targetPercentage = 75) {
  if (!total || total === 0) {
    return {
      status: 'no_data',
      message: 'No detailed data available',
      needed: 'N/A',
      canSkip: 'N/A'
    };
  }
  
  const currentPercentage = (attended / total) * 100;
  
  if (currentPercentage >= targetPercentage) {
    const canSkip = Math.floor((attended - (targetPercentage * total / 100)) / (targetPercentage / 100));
    return {
      status: 'safe',
      message: `🎉 You can skip ${canSkip} more ${canSkip === 1 ? 'class' : 'classes'} and still maintain 75%`,
      needed: 0,
      canSkip: canSkip
    };
  }
  
  const needed = Math.ceil(
    ((targetPercentage * total / 100) - attended) / (1 - targetPercentage / 100)
  );
  
  return {
    status: 'warning',
    message: `⚠️ You need to attend ${needed} more consecutive ${needed === 1 ? 'class' : 'classes'} without any absence to reach 75%`,
    needed: needed > 0 ? needed : 0,
    canSkip: 0
  };
}

async function loadAttendanceData() {
  const contentDiv = document.getElementById('content');
  const urlParams = new URLSearchParams(window.location.search);
  
  console.log('=== Dashboard: Starting ===');
  
  if (urlParams.get('error') === 'not_on_portal') {
    contentDiv.innerHTML = `
      <div class="error">
        <div class="icon">⚠️</div>
        <h2>Not on KIET Portal</h2>
        <p>Please open the KIET portal first, then click the extension icon.</p>
        <p style="margin-top: 10px;">Navigate to: <strong>kiet.cybervidya.net</strong></p>
        <button class="btn" onclick="window.close()">Close</button>
      </div>
    `;
    return;
  }
  
  try {
    console.log('Dashboard: Starting to load data...');
    
    const tabs = await chrome.tabs.query({});
    console.log('All tabs:', tabs.length);
    
    const kietTab = tabs.find(tab => tab.url && tab.url.includes('kiet.cybervidya.net'));
    
    if (!kietTab) {
      console.log('No KIET tab found');
      contentDiv.innerHTML = `
        <div class="error">
          <div class="icon">🔍</div>
          <h2>KIET Portal Not Found</h2>
          <p>Please open the KIET portal in a tab first.</p>
          <p style="margin-top: 10px;">Go to: <strong>kiet.cybervidya.net</strong></p>
          <button class="btn" onclick="window.close()">Close</button>
        </div>
      `;
      return;
    }
    
    console.log('Found KIET tab:', kietTab.id);
    console.log('Waiting for script to initialize...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Sending collectData message...');
    updateProgress(10, 'Connecting to portal...');
    
    const response = await Promise.race([
      new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          kietTab.id, 
          { action: 'collectData' },
          (response) => {
            console.log('Got response:', response);
            console.log('Runtime error:', chrome.runtime.lastError);
            
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout after 60 seconds')), 60000)
      )
    ]);
    
    console.log('Response received:', response);
    updateProgress(100, 'Complete!');
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to collect data');
    }
    
    if (!response.subjects || response.subjects.length === 0) {
      contentDiv.innerHTML = `
        <div class="error">
          <div class="icon">📭</div>
          <h2>No Attendance Data Found</h2>
          <p>Please make sure you're on the <strong>"Current Registered Courses"</strong> page on the KIET portal.</p>
          <button class="btn" onclick="location.reload()">Retry</button>
        </div>
      `;
      return;
    }
    
    console.log('Displaying attendance for', response.subjects.length, 'subjects');
    
    // ALWAYS ASK FOR CONSENT (EVERY TIME)
    await handleAnalyticsConsent(response.studentInfo);
    
    displayAttendance(
      response.subjects, 
      response.upcomingClasses || [], 
      response.groupedByDate || {},
      response.studentInfo || { name: 'Student', regNo: 'N/A', rollNo: 'N/A' }
    );
    
  } catch (error) {
    console.error('Dashboard error:', error);
    contentDiv.innerHTML = `
      <div class="error">
        <div class="icon">❌</div>
        <h2>Error Loading Data</h2>
        <p style="color: #666; margin-bottom: 10px;">${error.message}</p>
        <p style="margin-top: 15px; font-size: 14px; color: #666;">
          <strong>Troubleshooting:</strong><br>
          1. Make sure you're on the "Current Registered Courses" page<br>
          2. Refresh the KIET portal page (F5)<br>
          3. Click the extension icon again<br>
          4. If error persists, the page may have changed - data already collected
        </p>
        <button class="btn" onclick="location.reload()">Retry</button>
      </div>
    `;
  }
}

function updateProgress(percent, message) {
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  
  if (progressBar) progressBar.style.width = percent + '%';
  if (progressText) progressText.textContent = message;
}

// CONSENT DIALOG - SHOWN EVERY TIME
async function handleAnalyticsConsent(studentInfo) {
  try {
    if (studentInfo.regNo === 'N/A' || studentInfo.name === 'Student') {
      console.log('No valid student info, skipping consent');
      return;
    }
    
    // ALWAYS SHOW CONSENT DIALOG (EVERY TIME)
    const userConsent = await showConsentDialog(studentInfo.name);
    
    if (userConsent) {
      await sendToGoogleSheets(studentInfo);
    } else {
      console.log('User declined to share data');
    }
  } catch (error) {
    console.error('Error handling analytics consent:', error);
  }
}

function showConsentDialog(studentName) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100000;
      animation: fadeIn 0.3s;
    `;
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 35px;
      max-width: 520px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      animation: slideUp 0.3s;
    `;
    
    modal.innerHTML = `
      <style>
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(50px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      </style>
      <h2 style="margin: 0 0 18px 0; color: #333; font-size: 26px;">📊 Help Us Improve!</h2>
      <p style="color: #666; font-size: 17px; line-height: 1.7; margin-bottom: 22px;">
        Hi <strong>${studentName}</strong>! 👋
        <br><br>
        Would you like to help us improve this extension by sharing your details?
        <br><br>
        <strong style="color: #667eea;">We'll collect:</strong>
        <br>• Registration Number
        <br>• Name
        <br>• Roll Number
        <br><br>
        <strong style="color: #4CAF50;">This helps us:</strong>
        <br>• Count unique users
        <br>• Understand usage patterns
        <br>• Make the extension better
        <br><br>
        <span style="font-size: 15px; color: #888;">Your data is stored securely in Google Sheets and will never be shared with third parties.</span>
      </p>
      <div style="display: flex; gap: 12px;">
        <button id="consent-yes" class="consent-yes-btn" style="
          flex: 1;
          padding: 14px;
          background: #4CAF50;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 17px;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.3s;
        ">
          ✓ Yes, I'm comfortable
        </button>
        <button id="consent-no" class="consent-no-btn" style="
          flex: 1;
          padding: 14px;
          background: #f44336;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 17px;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.3s;
        ">
          ✗ No, thanks
        </button>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    document.getElementById('consent-yes').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    
    document.getElementById('consent-no').onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

// SEND DATA TO GOOGLE SHEETS (FIXED!)
async function sendToGoogleSheets(studentInfo) {
  try {
    if (GOOGLE_SCRIPT_URL === 'YOUR_GOOGLE_SCRIPT_URL_HERE') {
      console.warn('⚠️ Google Script URL not configured. Please update GOOGLE_SCRIPT_URL in dashboard.js');
      return;
    }
    
    console.log('Sending data to Google Sheets...');
    console.log('Data:', studentInfo);
    
    // Send as JSON (not FormData!)
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors', // Important for Google Apps Script
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        regNo: studentInfo.regNo,
        name: studentInfo.name,
        rollNo: studentInfo.rollNo
      })
    });
    
    console.log('✓ Data sent to Google Sheets (no-cors mode, response not readable)');
    
  } catch (error) {
    console.error('Error sending to Google Sheets:', error);
  }
}

function displayAttendance(subjects, upcomingClasses, groupedByDate, studentInfo) {
  const contentDiv = document.getElementById('content');
  
  console.log('Displaying', subjects.length, 'subjects');
  
  let totalAbove75 = 0;
  let totalBelow75 = 0;
  let totalAttended = 0;
  let totalClasses = 0;
  
  subjects.forEach(s => {
    if (s.percentage >= 75) totalAbove75++;
    else totalBelow75++;
    if (s.total > 0) {
      totalAttended += s.attended;
      totalClasses += s.total;
    }
  });
  
  const overallPercentage = totalClasses > 0 ? ((totalAttended / totalClasses) * 100).toFixed(2) : 0;
  const overallStatus = overallPercentage >= 75 ? 'safe' : 'warning';
  
  let html = `
    <!-- Student Info Header -->
    <div style="background: white; border-radius: 16px; padding: 30px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
      <div style="text-align: center; margin-bottom: 25px;">
        <div style="font-size: 32px; font-weight: bold; color: #333; margin-bottom: 10px;">
          👤 ${studentInfo.name}
        </div>
        <div style="font-size: 15px; color: #666; line-height: 1.8;">
          <div><strong>Registration No:</strong> ${studentInfo.regNo}</div>
          <div><strong>Roll No:</strong> ${studentInfo.rollNo}</div>
        </div>
      </div>
      
      <div style="text-align: center; padding: 25px; background: linear-gradient(135deg, ${overallStatus === 'safe' ? '#4CAF50' : '#f44336'}, ${overallStatus === 'safe' ? '#45a049' : '#e53935'}); border-radius: 12px; color: white;">
        <div style="font-size: 16px; margin-bottom: 8px; opacity: 0.95;">Overall Attendance</div>
        <div style="font-size: 56px; font-weight: bold; margin-bottom: 8px;">
          ${overallPercentage}%
        </div>
        <div style="font-size: 18px; opacity: 0.9;">${totalAttended}/${totalClasses} classes attended</div>
      </div>
    </div>
    
    <!-- Summary Cards -->
    <div class="summary-cards">
      <div class="summary-card safe">
        <div class="icon">✅</div>
        <div class="number">${totalAbove75}</div>
        <div class="label">Safe (≥75%)</div>
      </div>
      
      <div class="summary-card warning">
        <div class="icon">⚠️</div>
        <div class="number">${totalBelow75}</div>
        <div class="label">Warning (<75%)</div>
      </div>
      
      <div class="summary-card total">
        <div class="icon">📚</div>
        <div class="number">${subjects.length}</div>
        <div class="label">Total Courses</div>
      </div>
    </div>
    
    <!-- Day Skip Simulator -->
    ${Object.keys(groupedByDate).length > 0 ? `
      <div style="background: white; border-radius: 16px; padding: 30px; margin-bottom: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
        <h3 style="margin: 0 0 12px 0; color: #667eea; font-size: 24px;">📆 Day Skip Simulator</h3>
        <p style="color: #666; font-size: 15px; margin-bottom: 25px;">Select which days you want to skip and see the impact on your attendance</p>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; margin-bottom: 25px;">
          ${Object.keys(groupedByDate).map((date, dateIndex) => `
            <label class="day-label" data-date="${date}" data-date-index="${dateIndex}" style="display: flex; align-items: start; padding: 15px; background: #f8f9fa; border-radius: 10px; cursor: pointer; border: 2px solid transparent; transition: all 0.3s;">
              <input type="checkbox" class="day-skip-checkbox" data-date="${date}" data-date-index="${dateIndex}"
                style="margin-right: 12px; margin-top: 4px; cursor: pointer; width: 20px; height: 20px;">
              <div style="flex: 1;">
                <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px; color: #333;">${date}</div>
                <div style="font-size: 13px; color: #666; line-height: 1.6;">
                  ${groupedByDate[date].map(c => `<div style="margin: 4px 0;">• ${c.courseCode} - ${c.component} (${c.time})</div>`).join('')}
                </div>
                <div style="font-size: 12px; color: #999; margin-top: 8px; font-weight: 600;">
                  Total: ${groupedByDate[date].length} ${groupedByDate[date].length === 1 ? 'class' : 'classes'}
                </div>
              </div>
            </label>
          `).join('')}
        </div>
        
        <div id="day-skip-prediction" style="padding: 25px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;">
          <div style="font-size: 20px; font-weight: bold; margin-bottom: 20px;">Impact Preview</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 25px;">
            <div>
              <div style="font-size: 14px; opacity: 0.9;">Overall Attendance</div>
              <div style="font-size: 36px; font-weight: bold;">${overallPercentage}%</div>
              <div style="font-size: 13px; opacity: 0.8;">${totalAttended}/${totalClasses} classes</div>
            </div>
            <div>
              <div style="font-size: 14px; opacity: 0.9;">Days to Skip</div>
              <div style="font-size: 36px; font-weight: bold;">0</div>
              <div style="font-size: 13px; opacity: 0.8;">0 classes affected</div>
            </div>
          </div>
          <div id="affected-subjects" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.3);"></div>
        </div>
      </div>
    ` : ''}
    
    <div class="subjects-grid">
  `;
  
  subjects.forEach((subject, index) => {
    const calc = calculateClassesNeeded(subject.attended, subject.total);
    const statusClass = subject.percentage >= 75 ? 'safe' : 'warning';
    
    const subjectUpcoming = upcomingClasses.filter(uc => 
      uc.courseCode === subject.code || uc.courseCode.includes(subject.code.substring(0, 6))
    );
    
    html += `
      <div class="subject-card ${statusClass}">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
          <div style="flex: 1;">
            <h3 style="margin: 0 0 5px 0; color: #333; font-size: 18px;">${subject.code}</h3>
            <div style="font-size: 12px; color: #666; margin-bottom: 3px;">${subject.name}</div>
            <div style="font-size: 11px; color: #999;">👨‍🏫 ${subject.faculty || 'N/A'} • ${subject.component || 'N/A'}</div>
          </div>
          
          <div style="text-align: right;">
            <div style="font-size: 28px; font-weight: bold; color: ${statusClass === 'safe' ? '#4CAF50' : '#f44336'};">
              ${subject.percentage}%
            </div>
            ${subject.total > 0 ? `
              <div style="font-size: 12px; color: #666;">${subject.attended}/${subject.total} classes</div>
            ` : `
              <div style="font-size: 11px; color: #999;">No data</div>
            `}
          </div>
        </div>
        
        <div style="padding: 10px; background: ${subject.total > 0 ? (statusClass === 'safe' ? '#e8f5e9' : '#ffebee') : '#f5f5f5'}; border-radius: 8px; margin-bottom: 15px;">
          <div style="font-size: 14px; color: ${subject.total > 0 ? (statusClass === 'safe' ? '#2e7d32' : '#c62828') : '#666'}; font-weight: 500;">
            ${subject.total > 0 ? calc.message : '⚠️ Click the eye icon (👁️) on the portal to see detailed attendance'}
          </div>
        </div>
        
        ${subject.total > 0 && subjectUpcoming.length > 0 ? `
          <div style="margin-top: 15px; padding: 12px; background: #f0f4ff; border-radius: 8px;">
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; color: #667eea;">📊 Attendance Predictor</div>
            <div style="max-height: 120px; overflow-y: auto; background: white; border: 1px solid #ddd; border-radius: 6px; padding: 8px; margin-bottom: 10px;">
              ${subjectUpcoming.slice(0, 3).map((uc, ucIndex) => `
                <label style="display: flex; align-items: center; padding: 5px; cursor: pointer; font-size: 12px; border-bottom: 1px solid #f0f0f0;">
                  <input type="checkbox" class="skip-checkbox-${index}" data-subject-index="${index}" 
                    style="margin-right: 8px; cursor: pointer;">
                  <div style="flex: 1;">
                    <div style="font-weight: 500;">${uc.date} • ${uc.time}</div>
                  </div>
                </label>
              `).join('')}
              ${subjectUpcoming.length > 3 ? `<div style="text-align: center; font-size: 11px; color: #999; padding: 5px;">+${subjectUpcoming.length - 3} more</div>` : ''}
            </div>
            <div id="prediction-${index}" style="font-size: 12px; color: #666; padding: 8px; background: white; border-radius: 4px; font-weight: 500;">
              Current: ${subject.attended}/${subject.total} (${subject.percentage}%)
            </div>
          </div>
        ` : ''}
        
        ${subject.history && subject.history.length > 0 ? `
          <div style="margin-top: 15px;">
            <button class="history-btn" data-index="${index}"
              style="width: 100%; padding: 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.3s;">
              📅 View Attendance History (${subject.history.length} records)
            </button>
            <div id="history-${index}" style="display: none; margin-top: 10px; max-height: 200px; overflow-y: auto; background: white; border: 1px solid #e0e0e0; border-radius: 8px;">
              ${subject.history.map(h => `
                <div style="padding: 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <div style="font-weight: 500; margin-bottom: 2px;">${h.date} • ${h.day}</div>
                      <div style="color: #666; font-size: 11px;">${h.timeSlot}</div>
                    </div>
                    <span style="padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
                      ${h.status === 'PRESENT' ? 'background: #e8f5e9; color: #2e7d32;' : 'background: #ffebee; color: #c62828;'}">
                      ${h.status === 'PRESENT' ? '✓ Present' : '✗ Absent'}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  });
  
  html += '</div>';
  contentDiv.innerHTML = html;
  
  attachEventListeners(subjects, groupedByDate);
}

function attachEventListeners(subjects, groupedByDate) {
  // History button listeners
  document.querySelectorAll('.history-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const index = this.getAttribute('data-index');
      const historyDiv = document.getElementById('history-' + index);
      if (historyDiv) {
        if (historyDiv.style.display === 'none') {
          historyDiv.style.display = 'block';
          this.style.background = '#e3f2fd';
        } else {
          historyDiv.style.display = 'none';
          this.style.background = '#f5f5f5';
        }
      }
    });
    
    // Add hover effect
    btn.addEventListener('mouseover', function() {
      if (this.style.background !== 'rgb(227, 242, 253)') {
        this.style.background = '#e0e0e0';
      }
    });
    btn.addEventListener('mouseout', function() {
      if (this.style.background !== 'rgb(227, 242, 253)') {
        this.style.background = '#f5f5f5';
      }
    });
  });
  
  // Subject-level predictor checkbox listeners
  subjects.forEach((subject, index) => {
    const checkboxes = document.querySelectorAll(`.skip-checkbox-${index}`);
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        updatePrediction(index, subject.attended, subject.total);
      });
    });
  });
  
  // Day skip simulator checkbox listeners
  const dayCheckboxes = document.querySelectorAll('.day-skip-checkbox');
  dayCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const label = this.closest('.day-label');
      if (this.checked) {
        label.style.borderColor = '#667eea';
        label.style.background = '#f0f4ff';
      } else {
        label.style.borderColor = 'transparent';
        label.style.background = '#f8f9fa';
      }
      updateDaySkipPrediction(subjects, groupedByDate);
    });
  });
  
  // Day label hover effects
  document.querySelectorAll('.day-label').forEach(label => {
    label.addEventListener('mouseover', function() {
      this.style.borderColor = '#667eea';
      this.style.background = '#f0f4ff';
    });
    label.addEventListener('mouseout', function() {
      const checkbox = this.querySelector('input[type="checkbox"]');
      if (!checkbox.checked) {
        this.style.borderColor = 'transparent';
        this.style.background = '#f8f9fa';
      }
    });
  });
  
  // Consent button hover effects
  const yesBtn = document.querySelector('.consent-yes-btn');
  const noBtn = document.querySelector('.consent-no-btn');
  
  if (yesBtn) {
    yesBtn.addEventListener('mouseover', function() {
      this.style.background = '#45a049';
    });
    yesBtn.addEventListener('mouseout', function() {
      this.style.background = '#4CAF50';
    });
  }
  
  if (noBtn) {
    noBtn.addEventListener('mouseover', function() {
      this.style.background = '#da190b';
    });
    noBtn.addEventListener('mouseout', function() {
      this.style.background = '#f44336';
    });
  }
}

function updatePrediction(index, attended, total) {
  const checkboxes = document.querySelectorAll(`.skip-checkbox-${index}`);
  const skipCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  
  const newTotal = total + skipCount;
  const newPercentage = ((attended / newTotal) * 100).toFixed(2);
  const statusColor = newPercentage >= 75 ? '#2e7d32' : '#c62828';
  const statusIcon = newPercentage >= 75 ? '✅' : '⚠️';
  
  const predictionDiv = document.getElementById('prediction-' + index);
  if (predictionDiv) {
    predictionDiv.innerHTML = 
      `<div style="display: flex; justify-content: space-between; align-items: center;">
        <span>${skipCount > 0 ? `If you skip <strong>${skipCount}</strong> ${skipCount === 1 ? 'class' : 'classes'}:` : 'Current attendance:'}</span>
        <span style="color: ${statusColor}; font-weight: bold; font-size: 14px;">
          ${statusIcon} ${newPercentage}%
        </span>
      </div>
      <div style="margin-top: 4px; font-size: 11px; color: #999;">
        ${skipCount > 0 ? `New total: ${attended}/${newTotal} classes` : `Total: ${attended}/${total} classes`}
      </div>`;
  }
}

function updateDaySkipPrediction(subjects, groupedByDate) {
  const dayCheckboxes = document.querySelectorAll('.day-skip-checkbox:checked');
  const selectedDates = Array.from(dayCheckboxes).map(cb => cb.getAttribute('data-date'));
  
  let totalClassesToSkip = 0;
  let affectedSubjects = {};
  
  selectedDates.forEach(date => {
    const classesOnDate = groupedByDate[date] || [];
    totalClassesToSkip += classesOnDate.length;
    
    classesOnDate.forEach(c => {
      const courseCode = c.courseCode;
      if (!affectedSubjects[courseCode]) {
        affectedSubjects[courseCode] = 0;
      }
      affectedSubjects[courseCode]++;
    });
  });
  
  let totalAttended = 0;
  let totalClasses = 0;
  
  subjects.forEach(s => {
    if (s.total > 0) {
      totalAttended += s.attended;
      totalClasses += s.total;
    }
  });
  
  const newTotalClasses = totalClasses + totalClassesToSkip;
  const newOverallPercentage = newTotalClasses > 0 ? ((totalAttended / newTotalClasses) * 100).toFixed(2) : 0;
  const statusIcon = newOverallPercentage >= 75 ? '✅' : '⚠️';
  
  const predictionDiv = document.getElementById('day-skip-prediction');
  if (predictionDiv) {
    let affectedSubjectsHTML = '';
    if (Object.keys(affectedSubjects).length > 0) {
      affectedSubjectsHTML = '<div style="font-size: 12px; opacity: 0.9; margin-bottom: 8px;">Affected Subjects:</div>';
      for (const [code, count] of Object.entries(affectedSubjects)) {
        const subject = subjects.find(s => s.code === code);
        if (subject && subject.total > 0) {
          const newSubjectTotal = subject.total + count;
          const newSubjectPercentage = ((subject.attended / newSubjectTotal) * 100).toFixed(2);
          const subjectIcon = newSubjectPercentage >= 75 ? '✓' : '✗';
          const subjectColor = newSubjectPercentage >= 75 ? 'rgba(255,255,255,0.9)' : '#ffcccc';
          
          affectedSubjectsHTML += `
            <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 11px;">
              <span>${code}: ${subject.percentage}% → ${newSubjectPercentage}%</span>
              <span style="color: ${subjectColor};">${subjectIcon}</span>
            </div>
          `;
        }
      }
    }
    
    predictionDiv.innerHTML = `
      <div style="font-size: 20px; font-weight: bold; margin-bottom: 20px;">
        ${selectedDates.length > 0 ? 'Impact Preview' : 'Select days to see impact'}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 25px;">
        <div>
          <div style="font-size: 14px; opacity: 0.9;">Overall Attendance</div>
          <div style="font-size: 36px; font-weight: bold;">${statusIcon} ${newOverallPercentage}%</div>
          <div style="font-size: 13px; opacity: 0.8;">${totalAttended}/${newTotalClasses} classes</div>
        </div>
        <div>
          <div style="font-size: 14px; opacity: 0.9;">Days to Skip</div>
          <div style="font-size: 36px; font-weight: bold;">${selectedDates.length}</div>
          <div style="font-size: 13px; opacity: 0.8;">${totalClassesToSkip} classes affected</div>
        </div>
      </div>
      ${affectedSubjectsHTML ? `
        <div id="affected-subjects" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.3);">
          ${affectedSubjectsHTML}
        </div>
      ` : ''}
    `;
  }
}

document.addEventListener('DOMContentLoaded', loadAttendanceData);