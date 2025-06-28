// Ensure the DOM is fully loaded before trying to access elements
document.addEventListener('DOMContentLoaded', () => {
    // Get references to the button and the status display area
    const ankiBtn = document.getElementById('ankiBtn');
    const statusDiv = document.getElementById('status');

    // Add a click event listener to the button
    ankiBtn.addEventListener('click', async () => {
        // Update the status div to show the button was clicked
        statusDiv.textContent = 'Button clicked! (Logic for sending to Anki will go here later)';

        // In the future, this is where you might trigger sending
        // the selected text to your background script for processing.
        // For example:
        /*
        chrome.runtime.sendMessage({ action: "sendSelectedTextToAnki" }, (response) => {
            if (response && response.success) {
                statusDiv.textContent = "Flashcard sent successfully!";
            } else {
                statusDiv.textContent = "Failed to send flashcard.";
            }
        });
        */
    });
});
