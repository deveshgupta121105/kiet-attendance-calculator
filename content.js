console.log('KIET Attendance Extension: Content script loaded');

// FLAG TO PREVENT MULTIPLE EXECUTIONS
let isCollecting = false;
let hasCollected = false;

// Extract student information
function extractStudentInfo() {
  try {
    let name = '';
    let regNo = '';
    let rollNo = '';
    
    // Find the welcome box with student info
    const welcomeBox = document.querySelector('.dashboard-top-sm-box, [class*="dashboard-box"]');
    
    if (welcomeBox) {
      // Extract name - it's in an h5 after "Welcome"
      const h5Elements = welcomeBox.querySelectorAll('h5');
      if (h5Elements.length >= 2) {
        name = h5Elements[1].textContent.trim();
      }
      
      // Extract registration and roll number from the rows
      const labels = welcomeBox.querySelectorAll('.card-2-lbl');
      const cols = welcomeBox.querySelectorAll('.col-6');
      
      cols.forEach((col, index) => {
        const text = col.textContent.trim();
        const prevText = cols[index - 1]?.textContent.trim() || '';
        
        if (prevText.includes('Registration No')) {
          regNo = text;
        }
        if (prevText.includes('Roll No')) {
          rollNo = text;
        }
      });
    }
    
    console.log('Extracted student info:', { name, regNo, rollNo });
    return { 
      name: name || 'Student', 
      regNo: regNo || 'N/A',
      rollNo: rollNo || 'N/A'
    };
  } catch (error) {
    console.error('Error extracting student info:', error);
    return { name: 'Student', regNo: 'N/A', rollNo: 'N/A' };
  }
}

// Extract basic attendance data from table
function extractAttendanceData() {
  const subjects = [];
  const rows = document.querySelectorAll('tbody tr');
  
  rows.forEach((row, index) => {
    try {
      const courseCode = row.querySelectorAll('td')[1]?.textContent.trim();
      const courseName = row.querySelectorAll('td')[2]?.textContent.trim();
      const innerTable = row.querySelector('table');
      
      if (!innerTable) return;
      
      const innerRow = innerTable.querySelector('tr');
      if (!innerRow) return;
      
      const innerCells = innerRow.querySelectorAll('td');
      const component = innerCells[0]?.textContent.trim();
      const faculty = innerCells[3]?.textContent.trim();
      const attendanceText = innerCells[4]?.textContent.trim();
      const percentageMatch = attendanceText?.match(/(\d+\.?\d*)\s*%/);
      const percentage = percentageMatch ? parseFloat(percentageMatch[1]) : 0;
      
      const eyeButton = row.querySelector('a[title="View"] i.fa-eye');
      
      if (courseCode && courseName) {
        subjects.push({
          code: courseCode,
          name: courseName,
          component: component,
          faculty: faculty,
          percentage: percentage,
          eyeButton: eyeButton ? eyeButton.parentElement : null,
          rowIndex: index,
          attended: 0,
          total: 0
        });
      }
    } catch (error) {
      console.error('Error parsing row:', error);
    }
  });
  
  return subjects;
}

// Extract detailed data from modal
function extractDetailedAttendance() {
  const modal = document.querySelector('.modal-content');
  if (!modal) return null;
  
  try {
    const labels = modal.querySelectorAll('.lbl-title');
    const values = modal.querySelectorAll('.lbl-value');
    
    let courseName = '';
    let present = 0;
    let lecture = 0;
    let percentage = 0;
    
    labels.forEach((label, index) => {
      const labelText = label.textContent.trim();
      const valueText = values[index]?.textContent.trim();
      
      if (labelText.includes('Course Name')) {
        courseName = valueText;
      } else if (labelText.includes('Present')) {
        present = parseInt(valueText) || 0;
      } else if (labelText.includes('Lecture')) {
        lecture = parseInt(valueText) || 0;
      } else if (labelText.includes('Attendance %')) {
        const match = valueText.match(/(\d+\.?\d*)\s*%/);
        percentage = match ? parseFloat(match[1]) : 0;
      }
    });
    
    // Extract historical attendance data
    const historyTable = modal.querySelector('table');
    const history = [];
    
    if (historyTable) {
      const rows = historyTable.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
          const date = cells[1]?.textContent.trim();
          const day = cells[2]?.textContent.trim();
          const timeSlot = cells[3]?.textContent.trim();
          const lectureType = cells[4]?.textContent.trim();
          const attendanceCell = cells[5];
          
          const isPresent = attendanceCell?.textContent.includes('PRESENT');
          const isAbsent = attendanceCell?.textContent.includes('ABSENT');
          
          history.push({
            date,
            day,
            timeSlot,
            lectureType,
            status: isPresent ? 'PRESENT' : (isAbsent ? 'ABSENT' : 'UNKNOWN')
          });
        }
      });
    }
    
    return { courseName, present, lecture, percentage, history };
  } catch (error) {
    console.error('Error extracting modal data:', error);
    return null;
  }
}

// Close modal
function closeModal() {
  const closeButton = document.querySelector('#closeButton, [data-dismiss="modal"]');
  if (closeButton) {
    closeButton.click();
  }
}

// Extract upcoming classes from dashboard
function extractUpcomingClasses() {
  const upcomingClasses = [];
  
  try {
    const upcomingSection = document.querySelector('.upcoming-classes-exam, [class*="upcoming"]');
    if (!upcomingSection) return [];
    
    const cards = upcomingSection.querySelectorAll('.card');
    
    cards.forEach(card => {
      const labels = card.querySelectorAll('.card-2-lbl');
      if (labels.length >= 4) {
        const courseInfo = labels[0]?.textContent.trim();
        const date = labels[1]?.textContent.trim();
        const room = labels[2]?.textContent.trim().replace('Room:', '').trim();
        const time = labels[3]?.textContent.trim();
        
        const [courseCode, component] = courseInfo.split(' - ');
        
        upcomingClasses.push({
          courseCode: courseCode?.trim(),
          component: component?.trim(),
          date,
          time,
          room
        });
      }
    });
  } catch (error) {
    console.error('Error extracting upcoming classes:', error);
  }
  
  return upcomingClasses;
}

// Group upcoming classes by date
function groupClassesByDate(upcomingClasses) {
  const grouped = {};
  
  upcomingClasses.forEach(uc => {
    if (!grouped[uc.date]) {
      grouped[uc.date] = [];
    }
    grouped[uc.date].push(uc);
  });
  
  return grouped;
}

// Auto-click all eye buttons and gather data
async function autoCollectAllData() {
  const subjects = extractAttendanceData();
  const detailedSubjects = [];
  
  console.log(`Starting to collect data for ${subjects.length} subjects`);
  
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i];
    
    console.log(`Processing ${i + 1}/${subjects.length}: ${subject.code}`);
    
    if (subject.eyeButton) {
      subject.eyeButton.click();
      console.log('Waiting for modal to load...');
      await new Promise(resolve => setTimeout(resolve, 3500));
      
      const detailedData = extractDetailedAttendance();
      
      if (detailedData) {
        detailedSubjects.push({
          ...subject,
          attended: detailedData.present,
          total: detailedData.lecture,
          percentage: detailedData.percentage,
          history: detailedData.history || []
        });
        console.log(`✓ Got data: ${detailedData.present}/${detailedData.lecture}, ${detailedData.history?.length || 0} history records`);
      } else {
        detailedSubjects.push({...subject, history: []});
        console.log(`✗ No detailed data found in modal`);
      }
      
      closeModal();
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      detailedSubjects.push({...subject, history: []});
      console.log(`✗ No eye button found for ${subject.code}`);
    }
  }
  
  console.log('Collection complete!');
  return detailedSubjects;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('=== Content Script: Message received ===');
  console.log('Request:', request);
  
  if (request.action === 'collectData') {
    // PREVENT MULTIPLE EXECUTIONS
    if (isCollecting) {
      console.log('Already collecting data, ignoring request');
      sendResponse({ 
        success: false, 
        error: 'Data collection already in progress' 
      });
      return true;
    }
    
    if (hasCollected) {
      console.log('Data already collected, please refresh the page to collect again');
      sendResponse({ 
        success: false, 
        error: 'Data already collected. Please refresh the KIET portal page to collect again.' 
      });
      return true;
    }
    
    isCollecting = true;
    console.log('Starting auto data collection...');
    
    const basicSubjects = extractAttendanceData();
    console.log('Found subjects:', basicSubjects.length);
    
    if (basicSubjects.length === 0) {
      console.error('No subjects found on page!');
      isCollecting = false;
      sendResponse({ 
        success: false, 
        error: 'No subjects found. Make sure you are on the Current Registered Courses page.' 
      });
      return true;
    }
    
    console.log('Starting detailed collection for', basicSubjects.length, 'subjects...');
    
    autoCollectAllData().then(data => {
      console.log('Data collection complete! Collected', data.length, 'subjects');
      hasCollected = true;
      isCollecting = false;
      
      const studentInfo = extractStudentInfo();
      console.log('Student info:', studentInfo);
      
      const upcomingClasses = extractUpcomingClasses();
      const groupedByDate = groupClassesByDate(upcomingClasses);
      console.log('Found', upcomingClasses.length, 'upcoming classes');
      
      const responseData = { 
        success: true, 
        subjects: data, 
        upcomingClasses,
        groupedByDate,
        studentInfo
      };
      
      console.log('Sending response:', responseData);
      sendResponse(responseData);
    }).catch(error => {
      console.error('Error collecting data:', error);
      isCollecting = false;
      
      const studentInfo = extractStudentInfo();
      const upcomingClasses = extractUpcomingClasses();
      const groupedByDate = groupClassesByDate(upcomingClasses);
      
      sendResponse({ 
        success: true, 
        subjects: basicSubjects,
        upcomingClasses,
        groupedByDate,
        studentInfo
      });
    });
    
    return true;
  }
  
  console.log('Unknown action:', request.action);
  return false;
});