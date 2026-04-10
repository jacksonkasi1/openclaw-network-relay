document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('webhookUrl');
  const saveBtn = document.getElementById('saveBtn');
  const statusText = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleBtn');
  
  let isEnabled = true;

  function updateToggleUI() {
    if (isEnabled) {
      toggleBtn.textContent = 'ON';
      toggleBtn.classList.remove('off');
    } else {
      toggleBtn.textContent = 'OFF';
      toggleBtn.classList.add('off');
    }
  }

  // Load saved URL and state on open
  chrome.storage.local.get(['webhookUrl', 'isEnabled'], (res) => {
    if (res.webhookUrl) {
      urlInput.value = res.webhookUrl;
    }
    if (res.isEnabled !== undefined) {
      isEnabled = res.isEnabled;
      updateToggleUI();
    }
  });

  // Toggle button click logic
  toggleBtn.addEventListener('click', () => {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ isEnabled: isEnabled }, () => {
      updateToggleUI();
    });
  });

  // Save new URL on button click
  saveBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url) {
      chrome.storage.local.set({ webhookUrl: url }, () => {
        statusText.textContent = 'Saved!';
        setTimeout(() => {
          statusText.textContent = '';
        }, 2000);
      });
    } else {
      statusText.textContent = 'Please enter a valid URL';
      statusText.style.color = 'red';
      setTimeout(() => {
        statusText.textContent = '';
        statusText.style.color = 'green';
      }, 2000);
    }
  });
});