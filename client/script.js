document.addEventListener('DOMContentLoaded', () => {
    // Warn if not HTTPS or localhost
    if (
        window.location.protocol !== 'https:' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
    ) {
        alert(
            'Warning: Camera and microphone access will not work unless you access this app via HTTPS or localhost.\n\n' +
            'Current address: ' + window.location.href +
            '\n\nPlease use https:// or access via localhost for full functionality.'
        );
    }

    const signupForm = document.getElementById('signup-form');
    const signinForm = document.getElementById('signin-form');
    const signupMessage = document.getElementById('signup-message');
    const signinMessage = document.getElementById('signin-message');

    const showSigninLink = document.getElementById('show-signin');
    const showSignupLink = document.getElementById('show-signup');

    const signupContainer = document.getElementById('signup-container');
    const signinContainer = document.getElementById('signin-container');
    const chatContainer = document.getElementById('chat-container');
    const chatMessages = document.getElementById('chat-messages');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const chatStatus = document.getElementById('chat-status');
    const emojiTrigger = document.getElementById('emoji-trigger');
    const emojiPicker = document.getElementById('emoji-picker');
    const fileInput = document.getElementById('file-input');
    const attachFileButton = document.getElementById('attach-file-button');
    const fileUploadStatus = document.getElementById('file-upload-status');
    const typingIndicator = document.getElementById('typing-indicator');
    const onlineUsersList = document.getElementById('online-users-list');


    const API_BASE_URL = `http://${window.location.hostname}:3000`;
    const WS_URL = `ws://${window.location.hostname}:3000`;

    let socket;
    let currentUsername = '';
    let currentUserAvatarId = 'avatar_01';
    let sessionToken = '';

    const AVATAR_IDS = ["avatar_01", "avatar_02", "avatar_03"];
    let currentSelectedAvatarIdInPicker = AVATAR_IDS[0];

    const avatarOptionsContainer = document.getElementById('avatar-options');
    const selectedAvatarIdInput = document.getElementById('selected-avatar-id');
    const themeToggleButton = document.getElementById('theme-toggle-button');
    const gifPickerButton = document.getElementById('gif-picker-button');
    const googleSigninButton = document.getElementById('google-signin-button');
    const googleSignupButton = document.getElementById('google-signup-button');
    const gifModal = document.getElementById('gif-modal');
    const gifModalCloseButton = document.getElementById('gif-modal-close-button');
    const gifSearchInput = document.getElementById('gif-search-input');
    const gifResultsContainer = document.getElementById('gif-results-container');

    const GIPHY_API_KEY = 'QrbEowHMt1cOuTgEA4aS79GAaS5tH7x0';
    let giphySearchTimeout;

    let typingTimeoutInstance;
    const TYPING_TIMEOUT_DURATION = 1500;
    let isCurrentlyTyping = false;
    const usersTyping = new Set();

    // WebRTC Variables
    let peerConnection;
    let localStream;
    let remoteStream;
    let callInProgress = false;
    let targetUsernameForCall = null;
    let isVideoCall = false;
    const iceServers = { iceServers: [ /* { urls: 'stun:stun.l.google.com:19302' } */ ] };

    // DOM elements for call UI
    const incomingCallNotification = document.getElementById('incoming-call-notification');
    const callerUsernameNotification = document.getElementById('caller-username-notification');
    const answerCallButton = document.getElementById('answer-call-button');
    const rejectCallButton = document.getElementById('reject-call-button');
    const activeCallView = document.getElementById('active-call-view');
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const endCallButton = document.getElementById('end-call-button');
    const muteAudioButton = document.getElementById('mute-audio-button');
    const toggleVideoButton = document.getElementById('toggle-video-button');
    let isAudioMuted = false;
    let isVideoEnabled = true;

    // DM / Channel Management
    let currentChatContext = { type: 'global', name: 'Global Chat', avatarId: null };
    // let messageHistories = { 'Global Chat': [] }; // For future message history


    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function setChatFormDisabled(disabled) {
        if(messageInput) messageInput.disabled = disabled;
        if(chatForm) chatForm.querySelector('button[type="submit"]').disabled = disabled;
        if(emojiTrigger) emojiTrigger.disabled = disabled;
        if(attachFileButton) attachFileButton.disabled = disabled;
        if(gifPickerButton) gifPickerButton.disabled = disabled;
        if (disabled) {
            if(emojiPicker) emojiPicker.style.display = 'none';
            if(gifModal) gifModal.style.display = 'none';
        }
    }
    setChatFormDisabled(true);

    function populateAvatarPicker() {
        if (!avatarOptionsContainer) return;
        avatarOptionsContainer.innerHTML = '';
        if(selectedAvatarIdInput) selectedAvatarIdInput.value = currentSelectedAvatarIdInPicker;
        AVATAR_IDS.forEach(id => {
            const img = document.createElement('img');
            img.src = `assets/avatars/${id}.svg`;
            img.alt = `Avatar ${id.replace('_', ' ')}`;
            img.classList.add('avatar-option');
            img.dataset.avatarId = id;
            if (id === currentSelectedAvatarIdInPicker) img.classList.add('selected');
            img.addEventListener('click', () => {
                currentSelectedAvatarIdInPicker = id;
                if(selectedAvatarIdInput) selectedAvatarIdInput.value = id;
                document.querySelectorAll('#avatar-options .avatar-option').forEach(opt => opt.classList.remove('selected'));
                img.classList.add('selected');
            });
            avatarOptionsContainer.appendChild(img);
        });
    }

    if (showSigninLink) {
        showSigninLink.addEventListener('click', (e) => {
            e.preventDefault();
            if(signinContainer) signinContainer.style.display = 'block';
            if(signupContainer) signupContainer.style.display = 'none';
            clearMessages();
        });
    }

    if (showSignupLink) {
        showSignupLink.addEventListener('click', (e) => {
            e.preventDefault();
            if(signupContainer) signupContainer.style.display = 'block';
            if(signinContainer) signinContainer.style.display = 'none';
            populateAvatarPicker();
            clearMessages();
        });
    }

    function clearMessages() {
        if(signupMessage) { signupMessage.textContent = ''; signupMessage.className = ''; }
        if(signinMessage) { signinMessage.textContent = ''; signinMessage.className = ''; }
    }

    function displayMessage(element, message, type) {
        if(element) { element.textContent = message; element.className = type; }
    }

    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearMessages();
            const username = signupForm.username.value;
            const password = signupForm.password.value;
            const avatarId = selectedAvatarIdInput ? selectedAvatarIdInput.value : currentSelectedAvatarIdInPicker;
            try {
                const response = await fetch(`${API_BASE_URL}/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({ username, password, avatarId }),
                });
                const data = await response.json();
                if (response.ok && data.username) {
                    displayMessage(signupMessage, `${data.message} Welcome, ${data.username}!`, 'success');
                    signupForm.reset(); populateAvatarPicker();
                } else {
                    displayMessage(signupMessage, data.message || 'Sign-up failed', 'error');
                }
            } catch (error) {
                console.error('Sign-up error:', error);
                displayMessage(signupMessage, 'An unexpected error occurred during sign-up.', 'error');
            }
        });
    }

    if (signinForm) {
        signinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearMessages();
            const username = signinForm.username.value;
            const password = signinForm.password.value;
            try {
                const response = await fetch(`${API_BASE_URL}/signin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({ username, password }),
                });
                const data = await response.json();
                if (response.ok && data.success && data.token) {
                    displayMessage(signinMessage, data.message, 'success');
                    signinForm.reset();
                    sessionToken = data.token;
                    currentUserAvatarId = data.avatarId || AVATAR_IDS[0];
                    switchToChatView(data.username); // Pass username for initial header
                    connectWebSocket();
                } else {
                    displayMessage(signinMessage, data.message || 'Sign-in failed. No token or avatarId received.', 'error');
                }
            } catch (error) {
                console.error('Sign-in error:', error);
                displayMessage(signinMessage, 'An unexpected error occurred during sign-in.', 'error');
                setChatFormDisabled(true);
            }
        });
    }

    function switchToChatView(usernameToDisplay) {
        if (signupContainer) signupContainer.style.display = 'none';
        if (signinContainer) signinContainer.style.display = 'none';
        if (chatContainer) chatContainer.style.display = 'flex';
        currentUsername = usernameToDisplay; // Set currentUsername here
        updateChatHeader(); // Update header based on current context (likely global initially)
        if(chatStatus) { chatStatus.textContent = 'Connecting to chat...'; chatStatus.className = ''; }
        setChatFormDisabled(true);
    }

    function updateChatHeader() {
        const chatHeader = document.querySelector('#chat-container h2');
        if (chatHeader) {
            if (currentChatContext.type === 'dm') {
                chatHeader.textContent = `Chat with ${escapeHTML(currentChatContext.name)}`;
            } else { // Global or any other type
                chatHeader.textContent = `${currentChatContext.name}${currentUsername ? ' - Welcome ' + escapeHTML(currentUsername) : ''}`;
            }
        }
    }

    function switchToChatContext(username, avatarId = null) {
        if (callInProgress) {
            displaySystemMessage("Cannot switch chat context during an active call.", "error");
            return;
        }
        // Check if switching to the same DM context
        if (currentChatContext.type === 'dm' && currentChatContext.name === username) {
            return;
        }
        // Check if switching to Global when already Global
        if (currentChatContext.type === 'global' && username === null) { // Assuming username null for global switch
            return;
        }

        if (username === null) { // Switching to Global Chat
            console.log("Switching to Global Chat context");
            currentChatContext = { type: 'global', name: 'Global Chat', avatarId: null };
        } else { // Switching to DM
            console.log(`Switching chat context to DM with ${username}`);
            currentChatContext = { type: 'dm', name: username, avatarId: avatarId };
        }

        updateChatHeader();
        if(chatMessages) chatMessages.innerHTML = ''; // Clear messages

        // Update active class in user list
        document.querySelectorAll('#online-users-list li').forEach(li => {
            li.classList.remove('active-chat-context');
            if (username === null && li.id === 'global-chat-list-item') { // Global chat item
                 li.classList.add('active-chat-context');
            } else if (li.dataset.username === username) { // DM item
                li.classList.add('active-chat-context');
            }
        });
        // displaySystemMessage(`Switched to chat with ${username || 'Global Chat'}.`, 'system');
    }


    // WebRTC Functions (startLocalMedia, createPeerConnection, initiateCall, handleOffer, answerCall, handleAnswer, handleIceCandidate, closeCallLogic, closeCallAndUI, muteAudioLocal, toggleVideoLocal)
    // These functions remain largely the same as previously implemented.
    // Helper to send signaling messages
    function sendSignalingMessage(type, payload, targetUser = targetUsernameForCall) {
        if (socket && socket.readyState === WebSocket.OPEN && targetUser) {
            const message = { type: type, targetUsername: targetUser, ...payload };
            socket.send(JSON.stringify(message));
            console.log(`Sent ${type} to ${targetUser}`, payload);
        } else {
            console.error('Cannot send signaling message: WebSocket not open or target user not set.', { type, targetUser, payload });
            displaySystemMessage(`Error: Could not send call signal to ${targetUser}. Not connected?`, 'error');
        }
    }

    async function startLocalMedia(video = true, audio = true) {
        // Improved check for media device support
        if (
            typeof navigator === 'undefined' ||
            !navigator.mediaDevices ||
            typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
            displaySystemMessage(
                'Error: Camera/microphone access is not supported in this browser or context. ' +
                'Please use a modern browser and access the site via HTTPS or localhost. ' +
                'If you are on a local network, try using "localhost" or "127.0.0.1" instead of the LAN IP address.',
                'error'
            );
            return false;
        }
        try {
            if (localStream) { localStream.getTracks().forEach(track => track.stop()); }
            localStream = await navigator.mediaDevices.getUserMedia({ video: video, audio: audio });
            if (localVideo) { localVideo.srcObject = localStream; localVideo.style.display = video ? 'block' : 'none'; }
            isVideoEnabled = video; isAudioMuted = false;
            if(muteAudioButton) muteAudioButton.textContent = 'Mute Audio';
            if(toggleVideoButton) toggleVideoButton.textContent = isVideoEnabled ? 'Video Off' : 'Video On';
            return true;
        } catch (error) {
            console.error('Error accessing local media (getUserMedia):', error.name, error.message);
            displaySystemMessage(
                `Error accessing camera/microphone: ${error.name} - ${error.message}. ` +
                'Check browser permissions and ensure you are using HTTPS or localhost.',
                'error'
            );
            if(activeCallView) activeCallView.style.display = 'none';
            return false;
        }
    }

    function createPeerConnection() {
        if (peerConnection) { peerConnection.close(); }
        peerConnection = new RTCPeerConnection(iceServers);
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) sendSignalingMessage('webrtc_ice_candidate', { candidate: event.candidate });
        };
        peerConnection.ontrack = (event) => {
            if (remoteVideo && event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0]; remoteStream = event.streams[0];
                remoteVideo.style.display = 'block'; console.log('Remote stream added.');
            }
        };
        peerConnection.oniceconnectionstatechange = () => {
            if(peerConnection) {
                console.log('ICE connection state change:', peerConnection.iceConnectionState);
                if (['failed', 'disconnected', 'closed'].includes(peerConnection.iceConnectionState)) {
                    if (callInProgress && peerConnection.iceConnectionState !== 'closed') {
                         displaySystemMessage(`Call connection issue: ${peerConnection.iceConnectionState}.`, 'error');
                         closeCallAndUI(false);
                    }
                }
                 if (peerConnection.iceConnectionState === 'connected') {
                    displaySystemMessage(`Call connected with ${targetUsernameForCall}.`, 'info');
                }
            }
        };
        if (localStream) {
            localStream.getTracks().forEach(track => {
                try { peerConnection.addTrack(track, localStream); } catch (e) { console.error("Error adding track:", e); }
            });
        }
    }

    async function initiateCall(targetUser, video = true) {
        if (callInProgress) { displaySystemMessage("Call already in progress.", "error"); return; }
        if (!targetUser || targetUser === currentUsername) { displaySystemMessage("Invalid call target.", "error"); return; }
        targetUsernameForCall = targetUser; isVideoCall = video;
        if (!await startLocalMedia(isVideoCall, true)) {
            displaySystemMessage("Could not start local media. Call aborted.", "error"); targetUsernameForCall = null; return;
        }
        createPeerConnection();
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendSignalingMessage('webrtc_offer', { offer: offer, callType: isVideoCall ? 'video' : 'audio' });
            callInProgress = true;
            if(activeCallView) activeCallView.style.display = 'flex';
            if(localVideo) localVideo.style.display = isVideoCall ? 'block' : 'none';
            if(remoteVideo) remoteVideo.style.display = 'none';
            displaySystemMessage(`Calling ${targetUsernameForCall}...`, 'info');
            if(muteAudioButton) muteAudioButton.textContent = 'Mute Audio'; isAudioMuted = false;
            if(toggleVideoButton) {
                toggleVideoButton.textContent = isVideoCall ? 'Video Off' : 'Video On';
                toggleVideoButton.disabled = !isVideoCall;
            }
            isVideoEnabled = isVideoCall;
        } catch (error) {
            console.error('Error creating/sending offer:', error);
            displaySystemMessage(`Error starting call: ${error.message}`, 'error');
            closeCallAndUI(false);
        }
    }

    async function handleOffer(offerData, fromUsername) {
        if (callInProgress) {
            console.warn(`Incoming call from ${fromUsername} while another call active. Rejecting.`);
            sendSignalingMessage('call_rejected', { reason: 'User busy' }, fromUsername); return;
        }
        console.log(`Received offer from ${fromUsername}`, offerData);
        targetUsernameForCall = fromUsername; isVideoCall = offerData.callType === 'video';
        if (callerUsernameNotification) callerUsernameNotification.textContent = `${fromUsername} (${isVideoCall ? 'Video' : 'Audio'})`;
        if (incomingCallNotification) incomingCallNotification.style.display = 'block';
        window.currentOffer = offerData.offer; window.currentOfferFrom = fromUsername;
    }

    async function answerCall() {
        if (!window.currentOffer || !window.currentOfferFrom) {
            console.error("No current offer to answer."); if(incomingCallNotification) incomingCallNotification.style.display = 'none'; return;
        }
        console.log(`Answering ${isVideoCall ? 'video' : 'audio'} call from ${window.currentOfferFrom}`);
        targetUsernameForCall = window.currentOfferFrom;
        if (!await startLocalMedia(isVideoCall, true)) {
            console.error("Failed to get local media for answer.");
            sendSignalingMessage('call_rejected', { reason: 'Could not access media.' }, window.currentOfferFrom);
            if(incomingCallNotification) incomingCallNotification.style.display = 'none';
            window.currentOffer = null; window.currentOfferFrom = null; return;
        }
        createPeerConnection();
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(window.currentOffer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            sendSignalingMessage('webrtc_answer', { answer: answer });
            callInProgress = true;
            if(activeCallView) activeCallView.style.display = 'flex';
            if(localVideo) localVideo.style.display = isVideoCall ? 'block' : 'none';
            if(remoteVideo) remoteVideo.style.display = 'none';
            if(incomingCallNotification) incomingCallNotification.style.display = 'none';
            displaySystemMessage(`Call with ${targetUsernameForCall} started.`, 'info');
            if(muteAudioButton) muteAudioButton.textContent = 'Mute Audio'; isAudioMuted = false;
            if(toggleVideoButton) {
                 toggleVideoButton.textContent = isVideoCall ? 'Video Off' : 'Video On';
                 toggleVideoButton.disabled = !isVideoCall;
            }
            isVideoEnabled = isVideoCall;
        } catch (error) {
            console.error('Error creating/sending answer:', error);
            displaySystemMessage(`Error answering call: ${error.message}`, 'error');
            sendSignalingMessage('call_rejected', { reason: 'Error during answer generation.' }, window.currentOfferFrom);
            closeCallAndUI(false);
        } finally {
            window.currentOffer = null; window.currentOfferFrom = null;
        }
    }

    async function handleAnswer(answer) {
        if (!peerConnection) { console.error("Received answer, no peer connection."); return; }
        console.log('Received answer', answer);
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            displaySystemMessage(`Call with ${targetUsernameForCall} established.`, 'info');
            if(remoteVideo) remoteVideo.style.display = isVideoCall ? 'block' : 'none';
        } catch (error) {
            console.error('Error setting remote desc from answer:', error);
            displaySystemMessage(`Error establishing call: ${error.message}`, 'error');
            closeCallAndUI(false);
        }
    }

    async function handleIceCandidate(candidateInfo) {
         if (!peerConnection) { console.warn("Received ICE candidate, no peer connection."); return; }
         if (!candidateInfo || !candidateInfo.candidate) { console.warn("Empty ICE candidate received."); return; }
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidateInfo.candidate));
            console.log('Added received ICE candidate');
        } catch (error) {
            if (!error.message.includes("Error processing ICE candidate") && peerConnection && peerConnection.signalingState !== "closed") {
                 console.error('Error adding ICE candidate:', error);
            }
        }
    }

    function closeCallLogic() {
        if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
        if (remoteStream) { remoteStream.getTracks().forEach(track => track.stop()); remoteStream = null; }
        if (peerConnection) {
            peerConnection.onicecandidate = null; peerConnection.ontrack = null; peerConnection.oniceconnectionstatechange = null;
            peerConnection.close(); peerConnection = null;
        }
        callInProgress = false;
        if (localVideo) localVideo.srcObject = null; if (remoteVideo) remoteVideo.srcObject = null;
        console.log("Call resources cleaned up.");
    }

    function closeCallAndUI(notifyPeer = true) {
        console.log(`Closing call. Notify: ${notifyPeer}, Target: ${targetUsernameForCall}, InProgress: ${callInProgress}`);
        if (notifyPeer && targetUsernameForCall && callInProgress) {
            sendSignalingMessage('call_ended', { reason: 'User ended call.' });
        }
        closeCallLogic();
        if(activeCallView) activeCallView.style.display = 'none';
        if(incomingCallNotification) incomingCallNotification.style.display = 'none';
        if(muteAudioButton) muteAudioButton.textContent = 'Mute Audio'; isAudioMuted = false;
        if(toggleVideoButton) { toggleVideoButton.textContent = 'Video Off'; toggleVideoButton.disabled = false; }
        isVideoEnabled = true;
        displaySystemMessage(`Call with ${targetUsernameForCall || 'peer'} ended.`, 'info');
        targetUsernameForCall = null; isVideoCall = false;
        window.currentOffer = null; window.currentOfferFrom = null;
    }

    function muteAudioLocal() {
        isAudioMuted = !isAudioMuted;
        if (localStream) {
            const audioTracks = localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioTracks[0].enabled = !isAudioMuted;
                console.log(isAudioMuted ? "Audio Muted" : "Audio Unmuted");
                if (muteAudioButton) muteAudioButton.textContent = isAudioMuted ? 'Unmute Audio' : 'Mute Audio';
                return true;
            }
        }
        console.warn("No local audio track to mute/unmute."); return false;
    }

    function toggleVideoLocal() {
        if (!isVideoCall) { displaySystemMessage("Cannot toggle video in audio-only call.", "info"); return false; }
        isVideoEnabled = !isVideoEnabled;
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                videoTracks[0].enabled = isVideoEnabled;
                console.log(isVideoEnabled ? "Video On" : "Video Off");
                if (localVideo) localVideo.style.display = isVideoEnabled ? 'block' : 'none';
                if (toggleVideoButton) toggleVideoButton.textContent = isVideoEnabled ? 'Video Off' : 'Video On';
                return true;
            }
        }
        console.warn("No local video track to toggle."); return false;
    }

    function connectWebSocket() {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            if(chatStatus) chatStatus.textContent = 'Authenticating...';
            if (sessionToken) socket.send(sessionToken);
            else {
                if(chatStatus) { chatStatus.textContent = 'Auth error: No token.'; chatStatus.className = 'error'; }
                socket.close();
            }
        };

        socket.onmessage = (event) => {
            try {
                const parsedMessage = JSON.parse(event.data);
                switch (parsedMessage.type) {
                    case 'auth_success':
                        // currentUsername is set in switchToChatView after sign-in
                        currentUserAvatarId = parsedMessage.avatarId || AVATAR_IDS[0];
                        if(chatStatus) { chatStatus.textContent = `Authenticated as ${currentUsername}`; chatStatus.className = 'success'; }
                        updateChatHeader(); // Update header after currentUsername is confirmed
                        setChatFormDisabled(false);
                        displaySystemMessage(`Successfully joined. Messages appear in active context.`);
                        switchToChatContext(null); // Default to global on connect
                        break;
                    case 'auth_fail':
                        currentUsername = ''; currentUserAvatarId = AVATAR_IDS[0];
                        if(chatStatus) { chatStatus.textContent = `Auth failed: ${parsedMessage.message}`; chatStatus.className = 'error'; }
                        setChatFormDisabled(true); socket.close();
                        break;
                    case 'chat': // Further filtering for DM context will be in displayChatMessage or a new handler
                    case 'file':
                    case 'gif':
                        // Add fromUsername to messageData if not present, for DM handling in display
                        const messageDataWithSender = { ...parsedMessage, fromUsername: parsedMessage.username };
                        displayChatMessage(messageDataWithSender, parsedMessage.username, parsedMessage.timestamp, parsedMessage.avatarId);
                        break;
                    case 'user_typing_start':
                    case 'user_typing_stop':
                        handleTypingIndicator(parsedMessage);
                        break;
                    case 'user_list_update':
                        if (onlineUsersList) {
                            onlineUsersList.innerHTML = ''; // Clear old list

                            // Add Global Chat option
                            const globalLi = document.createElement('li');
                            globalLi.id = 'global-chat-list-item';
                            globalLi.classList.add('user-list-item');
                            globalLi.textContent = 'Global Chat';
                            globalLi.addEventListener('click', () => switchToChatContext(null));
                            if (currentChatContext.type === 'global') {
                                globalLi.classList.add('active-chat-context');
                            }
                            onlineUsersList.appendChild(globalLi);

                            parsedMessage.users.forEach(user => {
                                const listItem = document.createElement('li');
                                listItem.dataset.username = user.username;
                                listItem.dataset.avatarId = user.avatarId;
                                listItem.classList.add('user-list-item');

                                const avatarImg = document.createElement('img');
                                avatarImg.classList.add('chat-avatar');
                                avatarImg.style.width = '24px'; avatarImg.style.height = '24px';
                                if (user.avatarId && user.avatarId.startsWith('http')) avatarImg.src = user.avatarId;
                                else if (user.avatarId) avatarImg.src = `assets/avatars/${user.avatarId}.svg`;
                                else avatarImg.src = `assets/avatars/${AVATAR_IDS[0]}.svg`;
                                avatarImg.alt = `${user.username}'s avatar`;
                                listItem.appendChild(avatarImg);

                                const usernameSpan = document.createElement('span');
                                usernameSpan.textContent = escapeHTML(user.username);
                                listItem.appendChild(usernameSpan);

                                if (user.username !== currentUsername) {
                                    listItem.addEventListener('click', () => switchToChatContext(user.username, user.avatarId));
                                    const videoCallBtn = document.createElement('button');
                                    videoCallBtn.textContent = 'Video Call';
                                    videoCallBtn.classList.add('call-button', 'video-call-button');
                                    videoCallBtn.dataset.username = user.username;
                                    videoCallBtn.addEventListener('click', (e) => { e.stopPropagation(); initiateCall(user.username, true); });
                                    listItem.appendChild(videoCallBtn);
                                } else {
                                    usernameSpan.textContent += " (You)";
                                    listItem.classList.add('self-user-item'); // Make non-clickable for chat switch
                                }
                                if (currentChatContext.type === 'dm' && currentChatContext.name === user.username) {
                                    listItem.classList.add('active-chat-context');
                                }
                                onlineUsersList.appendChild(listItem);
                            });
                        }
                        break;
                    case 'webrtc_offer':
                        if (parsedMessage.fromUsername && parsedMessage.offer) handleOffer(parsedMessage, parsedMessage.fromUsername);
                        else console.error("Malformed webrtc_offer", parsedMessage);
                        break;
                    case 'webrtc_answer':
                        if (parsedMessage.fromUsername && parsedMessage.answer) handleAnswer(parsedMessage.answer);
                        else console.error("Malformed webrtc_answer", parsedMessage);
                        break;
                    case 'webrtc_ice_candidate':
                        if (parsedMessage.fromUsername && parsedMessage.candidate) handleIceCandidate(parsedMessage);
                        else console.error("Malformed webrtc_ice_candidate", parsedMessage);
                        break;
                    case 'call_rejected':
                        displaySystemMessage(`${parsedMessage.fromUsername} rejected call. ${parsedMessage.reason || ''}`, 'info');
                        closeCallAndUI(false);
                        break;
                    case 'call_ended':
                        displaySystemMessage(`Call with ${parsedMessage.fromUsername} ended. ${parsedMessage.reason || ''}`, 'info');
                        closeCallAndUI(false);
                        break;
                    case 'signaling_error':
                         displaySystemMessage(`Signaling Error: ${parsedMessage.message} (Target: ${parsedMessage.target || 'N/A'})`, 'error');
                         if (parsedMessage.target === targetUsernameForCall) closeCallAndUI(false);
                        break;
                    default:
                        console.warn('Unknown message type from server:', parsedMessage);
                }
            } catch (error) {
                console.error('Error parsing/handling server message:', error, event.data);
            }
        };

        socket.onclose = (event) => {
            if(chatStatus) {
                chatStatus.textContent = 'Disconnected.';
                if (!event.wasClean) chatStatus.textContent += ' Attempting to reconnect...';
                chatStatus.className = 'error';
            }
            setChatFormDisabled(true); usersTyping.clear(); updateTypingIndicatorUI();
            if (onlineUsersList) onlineUsersList.innerHTML = '';
            if (callInProgress) {
                displaySystemMessage('WebSocket disconnected during call. Ending call.', 'error');
                closeCallAndUI(false);
            }
            if (event.code !== 1000 && event.code !== 1008 ) {
                if (chatStatus && chatStatus.textContent.includes('Authentication failed')) return;
                setTimeout(connectWebSocket, 3000);
            }
        };
        socket.onerror = (error) => {
            if(chatStatus) { chatStatus.textContent = 'WebSocket connection error.'; chatStatus.className = 'error'; }
            setChatFormDisabled(true);
        };
    }

    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const messageText = messageInput.value.trim();
            if (messageText && socket && socket.readyState === WebSocket.OPEN && currentUsername) {
                let messagePayload = { content: messageText }; // Base payload
                if (currentChatContext.type === 'dm' && currentChatContext.name) {
                    messagePayload.targetUsername = currentChatContext.name;
                }
                // If it's a global message, no targetUsername is added, server handles broadcast.
                // Or, define a specific target for global if server expects it, e.g. targetUsername: 'global'

                socket.send(JSON.stringify(messagePayload)); // Send as JSON object

                // Client-side display for DMs now needs to be handled by received echo from server
                // or by more complex logic if we don't want to rely on echo for DMs.
                // For simplicity, we'll let the server echo it back for display.
                // displayChatMessage({ type: 'chat', content: messageText }, currentUsername, new Date().toISOString(), currentUserAvatarId);

                messageInput.value = '';
                if (isCurrentlyTyping) {
                    clearTimeout(typingTimeoutInstance);
                    let typingStopPayload = { type: 'typing_stop' };
                    if (currentChatContext.type === 'dm' && currentChatContext.name) {
                        typingStopPayload.targetUsername = currentChatContext.name;
                    }
                    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(typingStopPayload));
                    isCurrentlyTyping = false;
                }
            } else if (!currentUsername) displaySystemMessage('Cannot send: Not authenticated.', 'error');
            else if (!socket || socket.readyState !== WebSocket.OPEN) displaySystemMessage('Cannot send: Not connected.', 'error');
        });
    }

    if (messageInput) {
        messageInput.addEventListener('input', () => {
            if (!isCurrentlyTyping && socket && socket.readyState === WebSocket.OPEN && currentUsername) {
                let typingStartPayload = { type: 'typing_start' };
                if (currentChatContext.type === 'dm' && currentChatContext.name) {
                    typingStartPayload.targetUsername = currentChatContext.name;
                }
                socket.send(JSON.stringify(typingStartPayload));
                isCurrentlyTyping = true;
            }
            clearTimeout(typingTimeoutInstance);
            typingTimeoutInstance = setTimeout(() => {
                if (isCurrentlyTyping && socket && socket.readyState === WebSocket.OPEN && currentUsername) {
                    let typingStopPayload = { type: 'typing_stop' };
                    if (currentChatContext.type === 'dm' && currentChatContext.name) {
                        typingStopPayload.targetUsername = currentChatContext.name;
                    }
                    socket.send(JSON.stringify(typingStopPayload));
                    isCurrentlyTyping = false;
                }
            }, TYPING_TIMEOUT_DURATION);
        });
    }

    function handleTypingIndicator(parsedMessage) {
        const { username, type, targetUsername: msgTarget, fromUsername: msgFrom } = parsedMessage;

        // Check if this typing indicator is relevant to the current chat context
        let relevantToCurrentContext = false;
        if (currentChatContext.type === 'global' && !msgTarget) { // Global typing, no specific target
            relevantToCurrentContext = true;
        } else if (currentChatContext.type === 'dm' && msgTarget === currentUsername && msgFrom === currentChatContext.name) {
            // This is a DM, the target is me, and it's from the person I'm chatting with
            relevantToCurrentContext = true;
        } else if (currentChatContext.type === 'dm' && msgTarget === currentChatContext.name && msgFrom === currentUsername) {
            // This is a DM, I'm typing to my current DM target (less common to show self-typing, but server might echo)
            // Usually, we don't show our own typing indicator.
            return; // Don't show self-typing in DMs
        }


        if (relevantToCurrentContext && username !== currentUsername) {
            if (type === 'user_typing_start') usersTyping.add(username);
            else usersTyping.delete(username);
            updateTypingIndicatorUI();
        } else if (!relevantToCurrentContext && type === 'user_typing_stop' && usersTyping.has(username)) {
            // If user was typing in a context we are no longer viewing, remove them
            usersTyping.delete(username);
            updateTypingIndicatorUI();
        }
    }


    function updateTypingIndicatorUI() {
        if (!typingIndicator) return;
        if (usersTyping.size === 0) {
            typingIndicator.textContent = ''; typingIndicator.classList.add('typing-indicator-hidden');
        } else {
            const names = Array.from(usersTyping).map(name => escapeHTML(name));
            let text = '';
            if (names.length === 1) text = `${names[0]} is typing...`;
            else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing...`;
            else text = `${names.slice(0, 2).join(', ')} and others are typing...`;
            typingIndicator.textContent = text; typingIndicator.classList.remove('typing-indicator-hidden');
        }
    }

    function displayChatMessage(messageData, senderUsername, timestamp, senderAvatarIdParam = AVATAR_IDS[0]) {
        // messageData now includes fromUsername (original sender) and potentially targetUsername (for DMs)
        const { fromUsername, targetUsername: messageTargetUsername } = messageData;

        let relevantToCurrentView = false;
        if (currentChatContext.type === 'global' && !messageTargetUsername) {
            // Global message and current view is global
            relevantToCurrentView = true;
        } else if (currentChatContext.type === 'dm') {
            // Current view is a DM
            // Check if the message is part of this DM (either I am sender and target is context, or I am target and sender is context)
            if ((fromUsername === currentUsername && messageTargetUsername === currentChatContext.name) ||
                (fromUsername === currentChatContext.name && messageTargetUsername === currentUsername)) {
                relevantToCurrentView = true;
            }
        }

        if (!relevantToCurrentView) {
            // TODO: Handle notification for message in non-active DM context
            console.log(`Message for other context: From ${fromUsername} to ${messageTargetUsername || 'Global'}. Current: ${currentChatContext.name}`);
            // Example: update unread count on the user list item
            const userListItem = document.querySelector(`#online-users-list li[data-username='${fromUsername === currentUsername ? messageTargetUsername : fromUsername}']`);
            if (userListItem && fromUsername !== currentUsername) { // Don't show unread for own messages to other DMs
                let unreadBadge = userListItem.querySelector('.unread-badge');
                if (!unreadBadge) {
                    unreadBadge = document.createElement('span');
                    unreadBadge.classList.add('unread-badge');
                    // Insert badge before call button if exists, or at the end
                    const callBtn = userListItem.querySelector('.call-button');
                    if(callBtn) userListItem.insertBefore(unreadBadge, callBtn);
                    else userListItem.appendChild(unreadBadge);
                }
                unreadBadge.textContent = (parseInt(unreadBadge.textContent) || 0) + 1;
                unreadBadge.style.display = 'inline-block';
            }
            return;
        }

        // If relevant, clear unread badge for this context
        if (currentChatContext.type === 'dm') {
            const activeUserListItem = document.querySelector(`#online-users-list li[data-username='${currentChatContext.name}'] .unread-badge`);
            if (activeUserListItem) {
                activeUserListItem.textContent = '0';
                activeUserListItem.style.display = 'none';
            }
        }


        const messageElement = document.createElement('div');
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble');
        const messageTime = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const avatarImg = document.createElement('img');
        const actualSenderAvatar = (fromUsername === currentUsername) ? currentUserAvatarId : (messageData.avatarId || AVATAR_IDS[0]);
        if (actualSenderAvatar && actualSenderAvatar.startsWith('http')) avatarImg.src = actualSenderAvatar;
        else avatarImg.src = `assets/avatars/${actualSenderAvatar}.svg`;
        avatarImg.alt = `${escapeHTML(fromUsername)}'s avatar`;
        avatarImg.classList.add('chat-avatar');
        messageElement.appendChild(avatarImg);

        let contentHTML = `<strong>${fromUsername === currentUsername ? 'You' : escapeHTML(fromUsername)}</strong> <span class="timestamp">(${messageTime})</span>`;

        switch (messageData.type) {
            case 'chat':
                messageBubble.classList.add('message-text-content');
                contentHTML += `:<br>${escapeHTML(messageData.content)}`;
                break;
            case 'file': /* similar structure */
                messageBubble.classList.add('message-file-content');
                const fileInfo = messageData.fileInfo; // Assuming fileInfo is directly on messageData
                const safeFileName = escapeHTML(fileInfo.name);
                const fileUrl = fileInfo.url.startsWith('http') ? fileInfo.url : `${API_BASE_URL}${fileInfo.url}`;
                contentHTML += ` shared a file: <a href="${fileUrl}" target="_blank" rel="noopener noreferrer">${safeFileName}</a> (${formatFileSize(fileInfo.size)})`;
                break;
            case 'gif': /* similar structure */
                messageBubble.classList.add('message-gif-content');
                const gifInfo = messageData.gifInfo; // Assuming gifInfo is directly on messageData
                contentHTML += ` sent a GIF:<br><img src="${gifInfo.url}" alt="${escapeHTML(gifInfo.altText || 'User GIF')}" class="chat-gif-embed">`;
                break;
            default: console.error('Unknown message type in displayChatMessage:', messageData); return;
        }

        messageBubble.innerHTML = contentHTML;
        messageElement.appendChild(messageBubble);

        if (fromUsername === currentUsername) messageElement.classList.add('message-sent');
        else messageElement.classList.add('message-received');

        if(chatMessages) { chatMessages.appendChild(messageElement); chatMessages.scrollTop = chatMessages.scrollHeight; }
    }

    function displaySystemMessage(message, type = 'system') {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message-system');
        if (type === 'error') messageElement.classList.add('error');
        messageElement.innerHTML = `<em>${escapeHTML(message)}</em>`;
        if(chatMessages) { chatMessages.appendChild(messageElement); chatMessages.scrollTop = chatMessages.scrollHeight; }
    }

    // Emoji, File Upload, Theme Toggle, OAuth, GIF Picker (largely unchanged)
    if(emojiTrigger) {
        emojiTrigger.addEventListener('click', (e) => {
            e.stopPropagation(); if(emojiPicker) emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
        });
    }
    document.addEventListener('click', (e) => {
        if (emojiPicker && emojiPicker.style.display === 'flex' && !emojiPicker.contains(e.target) && e.target !== emojiTrigger) {
            emojiPicker.style.display = 'none';
        }
    });
    if(emojiPicker) {
        emojiPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji')) {
                const emoji = e.target.textContent; const start = messageInput.selectionStart; const end = messageInput.selectionEnd;
                messageInput.value = messageInput.value.substring(0, start) + emoji + messageInput.value.substring(end);
                messageInput.focus(); messageInput.setSelectionRange(start + emoji.length, start + emoji.length);
                messageInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
    if(attachFileButton) {
        attachFileButton.addEventListener('click', () => { if (attachFileButton.disabled) return; if(fileInput) fileInput.click(); });
    }
    if(fileInput) {
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0]; if (!file) return;
            const MAX_FILE_SIZE = 50 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                if(fileUploadStatus) { fileUploadStatus.textContent = `Error: File too large (Max ${MAX_FILE_SIZE / 1024 / 1024}MB).`; fileUploadStatus.className = 'error'; }
                fileInput.value = ''; return;
            }
            if(fileUploadStatus) { fileUploadStatus.textContent = `Uploading ${file.name}...`; fileUploadStatus.className = ''; }
            const formData = new FormData(); formData.append('file', file);
            try {
                const response = await fetch(`${API_BASE_URL}/upload`, { method: 'POST', body: formData, });
                const data = await response.json();
                if (response.ok && data.success) {
                    if(fileUploadStatus) { fileUploadStatus.textContent = `Upload successful, sharing...`; fileUploadStatus.className = 'success'; }
                    if (socket && socket.readyState === WebSocket.OPEN && currentUsername) {
                        let fileMessage = {
                            type: 'file',
                            fileInfo: { name: data.filename, originalName: file.name, url: data.url, mimetype: data.mimetype, size: data.size }
                        };
                        if (currentChatContext.type === 'dm' && currentChatContext.name) {
                            fileMessage.targetUsername = currentChatContext.name;
                        }
                        socket.send(JSON.stringify(fileMessage));
                        if(fileUploadStatus) fileUploadStatus.textContent = `Shared ${file.name}`;
                        setTimeout(() => { if(fileUploadStatus) {fileUploadStatus.textContent = ''; fileUploadStatus.className='';} }, 3000);
                    } else { if(fileUploadStatus) { fileUploadStatus.textContent = 'Upload OK, but chat not connected.'; fileUploadStatus.className = 'error';} }
                } else { if(fileUploadStatus) { fileUploadStatus.textContent = `Upload failed: ${data.message || 'Server error'}`; fileUploadStatus.className = 'error';} }
            } catch (error) {
                console.error('File upload error:', error);
                if(fileUploadStatus) { fileUploadStatus.textContent = 'Upload failed. Network error.'; fileUploadStatus.className = 'error'; }
            } finally { fileInput.value = ''; }
        });
    }
    if(themeToggleButton) {
        function applyTheme(theme) {
            if (theme === 'dark') { document.body.classList.add('dark-theme'); themeToggleButton.textContent = '🌙'; themeToggleButton.title = "Switch to Light"; }
            else { document.body.classList.remove('dark-theme'); themeToggleButton.textContent = '☀️'; themeToggleButton.title = "Switch to Dark"; }
        }
        const savedTheme = localStorage.getItem('theme') || 'light'; applyTheme(savedTheme);
        themeToggleButton.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
            applyTheme(newTheme); localStorage.setItem('theme', newTheme);
        });
    }
    if (signupContainer && (!signinContainer || signinContainer.style.display === 'none')) populateAvatarPicker();
    if (googleSigninButton) googleSigninButton.addEventListener('click', () => { window.location.href = `${API_BASE_URL}/auth/google`; });
    if (googleSignupButton) googleSignupButton.addEventListener('click', () => { window.location.href = `${API_BASE_URL}/auth/google`; });
    const urlParams = new URLSearchParams(window.location.search);
    const oauthToken = urlParams.get('token'); const oauthUsername = urlParams.get('username');
    const oauthAvatarId = urlParams.get('avatarId'); const isOAuth = urlParams.get('isOAuth');
    if (isOAuth === 'true' && oauthToken && oauthUsername) {
        console.log('OAuth callback detected.'); sessionToken = oauthToken;
        // currentUsername set by switchToChatView
        currentUserAvatarId = oauthAvatarId; switchToChatView(oauthUsername);
        if(chatStatus) { chatStatus.textContent = `Authenticated as ${oauthUsername} via OAuth.`; chatStatus.className = 'success'; }
        setChatFormDisabled(false);
        if (!socket || socket.readyState === WebSocket.CLOSED) connectWebSocket();
        else if (socket.readyState === WebSocket.OPEN) socket.close(); // Will trigger reconnect in onclose
        window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
    } else if (urlParams.get('authError')) {
        const authError = urlParams.get('authError'); const authProvider = urlParams.get('authProvider') || "OAuth";
        if (signinMessage) displayMessage(signinMessage, `${authProvider} Sign-in Error: ${authError}`, 'error');
        else alert(`${authProvider} Sign-in Error: ${authError}`);
        window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
    }
    if(gifPickerButton) gifPickerButton.addEventListener('click', () => { if (gifPickerButton.disabled) return; if(gifModal) gifModal.style.display = 'block'; });
    if(gifModalCloseButton) gifModalCloseButton.addEventListener('click', () => { if(gifModal) gifModal.style.display = 'none'; });
    if(gifModal) gifModal.addEventListener('click', (event) => { if (event.target === gifModal) gifModal.style.display = 'none'; });
    if(gifSearchInput) {
        gifSearchInput.addEventListener('input', () => {
            clearTimeout(giphySearchTimeout);
            giphySearchTimeout = setTimeout(() => { fetchGifs(gifSearchInput.value.trim()); }, 500);
        });
    }
    async function fetchGifs(searchTerm) { /* ... unchanged ... */ }
    if(gifPickerButton) { /* ... click event ... */ } // Already above
    async function fetchGifs(searchTerm) {
        if(!gifResultsContainer) return;
        gifResultsContainer.innerHTML = '';
        const loadingMessage = document.createElement('p'); loadingMessage.id = 'gif-loading-message';
        if (!searchTerm) { loadingMessage.textContent = 'Search for GIFs above.'; gifResultsContainer.appendChild(loadingMessage); return; }
        if (GIPHY_API_KEY === 'YOUR_GIPHY_API_KEY_PLACEHOLDER' || (GIPHY_API_KEY === 'QrbEowHMt1cOuTgEA4aS79GAaS5tH7x0' && searchTerm === 'access_key_not_working') ) {
             gifResultsContainer.innerHTML = '<p style="color:var(--error-text-color);">Giphy API Key needed or invalid.</p>'; return;
        }
        loadingMessage.textContent = 'Searching for GIFs... ⏳'; gifResultsContainer.appendChild(loadingMessage);
        const giphySearchURL = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchTerm)}&limit=12&offset=0&rating=g&lang=en`;
        try {
            const response = await fetch(giphySearchURL);
            const existingLoadingMessage = document.getElementById('gif-loading-message'); if (existingLoadingMessage) existingLoadingMessage.remove();
            if (!response.ok) throw new Error(`Giphy API error: ${response.statusText} (${response.status})`);
            const data = await response.json();
            if (data.data && data.data.length > 0) {
                data.data.forEach(gif => {
                    const img = document.createElement('img'); img.src = gif.images.fixed_height_small.url; img.alt = gif.title || "GIF";
                    img.classList.add('gif-result-img'); img.dataset.originalUrl = gif.images.original.url; img.dataset.previewUrl = gif.images.fixed_height.url;
                    img.addEventListener('click', () => {
                        const gifInfoForMessage = { url: img.dataset.previewUrl, altText: img.alt, originalUrl: img.dataset.originalUrl };
                        if (socket && socket.readyState === WebSocket.OPEN && currentUsername) {
                            let gifMessagePayload = { type: 'gif', gifInfo: gifInfoForMessage };
                            if (currentChatContext.type === 'dm' && currentChatContext.name) {
                                gifMessagePayload.targetUsername = currentChatContext.name;
                            }
                            socket.send(JSON.stringify(gifMessagePayload));
                        } else displaySystemMessage('Cannot send GIF: Not connected/authenticated.', 'error');
                        if(gifModal) gifModal.style.display = 'none'; if(gifSearchInput) gifSearchInput.value = ''; if(gifResultsContainer) gifResultsContainer.innerHTML = '';
                    });
                    gifResultsContainer.appendChild(img);
                });
            } else gifResultsContainer.innerHTML = '<p>No GIFs found for that search.</p>';
        } catch (error) {
            console.error('Error fetching GIFs:', error);
            if(gifResultsContainer) gifResultsContainer.innerHTML = `<p style="color:var(--error-text-color);">Error fetching GIFs: ${error.message}</p>`;
        }
    }

    // Event Listeners for Call Control Buttons
    if (answerCallButton) answerCallButton.addEventListener('click', answerCall);
    if (rejectCallButton) {
        rejectCallButton.addEventListener('click', () => {
            if (window.currentOfferFrom) sendSignalingMessage('call_rejected', { reason: 'User rejected call.' }, window.currentOfferFrom);
            if(incomingCallNotification) incomingCallNotification.style.display = 'none';
            window.currentOffer = null; window.currentOfferFrom = null;
        });
    }
    if (endCallButton) endCallButton.addEventListener('click', () => closeCallAndUI(true));
    if (muteAudioButton) muteAudioButton.addEventListener('click', muteAudioLocal);
    if (toggleVideoButton) toggleVideoButton.addEventListener('click', toggleVideoLocal);

    // Initial setup
    updateChatHeader(); // Set initial header correctly
});
