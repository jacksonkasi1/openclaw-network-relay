// The specific class names of the confirmation card you provided
const CARD_SELECTOR = 'div.border-token-border-heavy.bg-token-bg-primary.rounded-3xl.border.p-5';
// The specific class names of the primary confirm button
const BUTTON_SELECTOR = 'button.btn-primary';

function autoClickConfirmButton() {
    // Find all cards matching the permission dialog style
    const cards = document.querySelectorAll(CARD_SELECTOR);

    cards.forEach(card => {
        // Find the primary action button inside this specific card
        const confirmBtn = card.querySelector(BUTTON_SELECTOR);

        // If the button exists and hasn't been clicked yet
        if (confirmBtn && !confirmBtn.dataset.autoClicked) {
            console.log("Auto-clicking ChatGPT tool permission button...");

            // Mark it as clicked to avoid infinite clicking loops while it fades out
            confirmBtn.dataset.autoClicked = "true";

            // Click the button
            confirmBtn.click();
        }
    });
}

// Set up a MutationObserver to watch for changes on the page (since ChatGPT is a single-page app)
const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;

    // Only run the check if new nodes were added to the DOM
    for (let mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            shouldCheck = true;
            break;
        }
    }

    if (shouldCheck) {
        autoClickConfirmButton();
    }
});

// Start observing the whole body for new UI elements
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Run once on load just in case it's already there
autoClickConfirmButton();
console.log("GPT Auto Accept MCP extension loaded and watching.");
