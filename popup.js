document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('webhookUrl');
  const saveBtn = document.getElementById('saveBtn');
  const statusText = document.getElementById('status');

  // Load saved URL on open
  chrome.storage.local.get(['webhookUrl'], (res) => {
    if (res.webhookUrl) {
      urlInput.value = res.webhookUrl;
    }
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