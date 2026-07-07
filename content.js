// Recon content script — detects company + scrapes LinkedIn intel

(function () {
  let detected = null;
  let linkedinData = null;

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  if (window.location.hostname === 'www.linkedin.com') {
    // Detect company name
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) detected = ogTitle.getAttribute('content')?.replace(' | LinkedIn', '').trim();
    if (!detected) {
      const h1 = document.querySelector('h1.org-top-card-summary__title, h1.top-card-layout__title, h1');
      if (h1) detected = h1.textContent.trim();
    }

    // Only scrape on company pages
    if (window.location.pathname.startsWith('/company/')) {
      linkedinData = scrapeLinkedIn();
    }
  }

  // ── Salesforce ────────────────────────────────────────────────────────────
  if (window.location.hostname.includes('.salesforce.com') || window.location.hostname.includes('.force.com')) {
    const recordName = document.querySelector('.slds-page-header__title span, .entityNameTitle, .forceOutputLookup');
    if (recordName) detected = recordName.textContent.trim();
  }

  // Send to extension
  if (detected && detected.length > 1 && detected.length < 100) {
    chrome.runtime.sendMessage({
      type: 'COMPANY_DETECTED',
      company: detected,
      source: window.location.hostname,
      linkedinData: linkedinData || null
    });
  }

  function scrapeLinkedIn() {
    const data = {};

    try {
      // About section
      const about = document.querySelector('.org-about-module__multiline-description, .about-us__description, [data-test-id="about-us__description"]');
      if (about) data.about = about.textContent.trim().slice(0, 500);

      // Employee count
      const empEl = document.querySelector('.org-about-company-module__company-staff-count-range, [data-test-id="about-us__size"]');
      if (empEl) data.employeeCount = empEl.textContent.trim();

      // Industry
      const industryEl = document.querySelector('.org-about-company-module__industry, [data-test-id="about-us__industry"]');
      if (industryEl) data.industry = industryEl.textContent.trim();

      // Headquarters
      const hqEl = document.querySelector('.org-about-company-module__headquarters, [data-test-id="about-us__headquarters"]');
      if (hqEl) data.headquarters = hqEl.textContent.trim();

      // Recent posts — scrape up to 5
      const posts = [];
      const postEls = document.querySelectorAll('.feed-shared-update-v2, .occludable-update, [data-id]');
      postEls.forEach((post, i) => {
        if (i >= 5) return;
        const textEl = post.querySelector('.feed-shared-text, .feed-shared-update-v2__description, .update-components-text');
        const dateEl = post.querySelector('.feed-shared-actor__sub-description, time');
        if (textEl) {
          posts.push({
            text: textEl.textContent.trim().slice(0, 300),
            date: dateEl?.textContent?.trim() || null
          });
        }
      });
      if (posts.length > 0) data.recentPosts = posts;

      // Hiring signals — check for job postings count
      const jobsEl = document.querySelector('[data-test-id="jobs-module__headline"], .jobs-module__headline');
      if (jobsEl) data.hiringSignal = jobsEl.textContent.trim();

      // Latest updates / announcements
      const updateEls = document.querySelectorAll('.org-updates-list__item');
      const updates = [];
      updateEls.forEach((u, i) => {
        if (i >= 3) return;
        const text = u.textContent.trim().slice(0, 200);
        if (text) updates.push(text);
      });
      if (updates.length > 0) data.updates = updates;

      data.url = window.location.href;
      data.scrapedAt = new Date().toISOString();

    } catch (e) {
      data.error = e.message;
    }

    return Object.keys(data).length > 1 ? data : null;
  }

})();
