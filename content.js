// Log a message to the console to confirm the content script is loaded
console.log("Glossari content script loaded!");

// Listener for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Check if the message is to display information on the page
    if (request.action === "displayInfo") {
        const infoMessage = request.data;
        
        // Find or create a div to display messages on the page
        let GlossariDisplay = document.getElementById('glossari-display');
        if (!GlossariDisplay) {
            GlossariDisplay = document.createElement('div');
            GlossariDisplay.id = 'glossari-display';
            // Basic styling for the display box
            Object.assign(GlossariDisplay.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #ccc',
                padding: '10px',
                borderRadius: '8px',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                zIndex: '99999', // Ensure it's on top of other content
                maxWidth: '300px',
                fontFamily: 'Inter, sans-serif', // Use Inter or fallback to sans-serif
                fontSize: '14px',
                color: '#333'
            });
            document.body.appendChild(GlossariDisplay);
        }
        
        GlossariDisplay.textContent = infoMessage;

        // Optionally, make it disappear after a few seconds
        setTimeout(() => {
            if (GlossariDisplay) {
                GlossariDisplay.remove();
            }
        }, 5000); // Remove after 5 seconds
    }
});

// We will add more logic here later for getting the selected text directly
// (e.g., when you right-click on text)