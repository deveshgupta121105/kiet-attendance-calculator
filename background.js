// Background script to handle extension icon click
// Tracks which tabs have already been processed to prevent multiple injections

const processedTabs = new Set();

chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked');
  console.log('Current tab URL:', tab.url);
  
  try {
    // Check if user is on KIET portal
    if (tab.url && tab.url.includes('kiet.cybervidya.net')) {
      console.log('On KIET portal - opening dashboard');
      
      // Mark this tab as processed to prevent re-injection
      processedTabs.add(tab.id);
      
      // Open the dashboard in a new tab
      const dashboardUrl = chrome.runtime.getURL('dashboard.html') + '?tabId=' + tab.id;
      console.log('Dashboard URL:', dashboardUrl);
      
      await chrome.tabs.create({
        url: dashboardUrl,
        active: true
      });
    } else {
      console.log('Not on KIET portal - showing error');
      
      // Open dashboard with error parameter
      const dashboardUrl = chrome.runtime.getURL('dashboard.html?error=not_on_portal');
      
      await chrome.tabs.create({
        url: dashboardUrl,
        active: true
      });
    }
  } catch (error) {
    console.error('Error in background script:', error);
  }
});

// Clean up processed tabs when they are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  processedTabs.delete(tabId);
});