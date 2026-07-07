// Recon background service worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COMPANY_DETECTED') {
    // Store company name for auto-fill
    chrome.storage.local.set({
      recon_last_company: message.company,
      recon_auto_search: true,
      recon_linkedin_data: message.linkedinData || null,
      recon_linkedin_url: sender.tab?.url || null
    });
  }
});

// Clear LinkedIn data when tab changes away from LinkedIn
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab?.url && !tab.url.includes('linkedin.com')) {
      chrome.storage.local.remove(['recon_linkedin_data', 'recon_linkedin_url']);
    }
  });
});
