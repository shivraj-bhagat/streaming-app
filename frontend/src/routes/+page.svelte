<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import io, { Socket } from 'socket.io-client';

	let socket: Socket;
	let localVideo: HTMLVideoElement;
	let remoteVideo: HTMLVideoElement;
	let peerConnection: RTCPeerConnection;
	let localStream: MediaStream;
	let connectionStatus: string = 'Initializing...';

	// Dynamic configuration
	const SERVER_URL = import.meta.env.VITE_SERVER_URL;
	const ROOM_ID = 'test-room';

	// Comprehensive ICE configuration
	const configuration: RTCConfiguration = {
		iceServers: [
			// Local and public STUN servers
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
			{ urls: 'stun:stun2.l.google.com:19302' }

			// Optional: Add your local TURN server if needed
			// {
			// 	urls: 'turn:your-local-turn-server.local',
			// 	username: 'local-username',
			// 	credential: 'local-password'
			// }
		],
		iceCandidatePoolSize: 10,
		rtcpMuxPolicy: 'require',
		bundlePolicy: 'max-bundle'
	};

	async function initializeWebRTC() {
		try {
			connectionStatus = 'Initializing WebRTC...';

			// Get local media stream with flexible constraints
			console.log('Getting local media stream...', navigator.mediaDevices);
			localStream = await navigator.mediaDevices.getUserMedia({
				video: {
					width: { min: 640, ideal: 1280, max: 1920 },
					height: { min: 480, ideal: 720, max: 1080 },
					frameRate: { ideal: 30, max: 60 }
				},
				audio: true // Enable audio
			});

			if (localVideo) {
				localVideo.srcObject = localStream;
				await localVideo.play();
			}

			// Initialize peer connection
			peerConnection = new RTCPeerConnection(configuration);

			// Add local tracks to peer connection
			localStream.getTracks().forEach((track) => {
				peerConnection.addTrack(track, localStream);
			});

			// Set up event listeners
			setupPeerConnectionListeners();

			// Create and send offer
			await createAndSendOffer();

			connectionStatus = 'WebRTC Initialized';
		} catch (error) {
			connectionStatus = 'WebRTC Initialization Failed';
			console.error('WebRTC Initialization Error:', error);
			alert(`Failed to initialize WebRTC: ${(error as Error).message}`);
		}
	}

	function setupPeerConnectionListeners() {
		// ICE candidate handling
		peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				console.log('ICE Candidate generated:', event.candidate);
				socket.emit('ice-candidate', {
					roomId: ROOM_ID,
					candidate: event.candidate
				});
			}
		};

		// Detailed connection state monitoring
		peerConnection.onconnectionstatechange = () => {
			connectionStatus = peerConnection.connectionState;
			console.log('Peer Connection State:', peerConnection.connectionState);
			console.log('ICE Connection State:', peerConnection.iceConnectionState);

			switch (peerConnection.connectionState) {
				case 'connecting':
					connectionStatus = 'Connecting...';
					break;
				case 'connected':
					connectionStatus = 'Connected';
					break;
				case 'disconnected':
					connectionStatus = 'Disconnected';
					restartConnection();
					break;
				case 'failed':
					connectionStatus = 'Connection Failed';
					restartConnection();
					break;
			}
		};

		// Track handling
		peerConnection.ontrack = async (event) => {
			console.log('Remote track received:', event);

			if (event.streams && event.streams.length > 0) {
				if (remoteVideo) {
					remoteVideo.srcObject = event.streams[0];
					try {
						await remoteVideo.play();
						connectionStatus = 'Remote Video Playing';
					} catch (error) {
						connectionStatus = 'Remote Video Error';
						console.error('Error playing remote video:', error);
					}
				}
			}
		};
	}

	async function createAndSendOffer() {
		try {
			const offer = await peerConnection.createOffer({
				offerToReceiveVideo: true,
				offerToReceiveAudio: true
			});

			await peerConnection.setLocalDescription(offer);

			console.log('Offer created, sending to server');
			socket.emit('offer', {
				roomId: ROOM_ID,
				offer: peerConnection.localDescription
			});
		} catch (error) {
			console.error('Error creating offer:', error);
		}
	}

	function restartConnection() {
		console.warn('Restarting WebRTC connection');
		if (peerConnection) {
			peerConnection.close();
		}
		initializeWebRTC();
	}

	// Network debugging function
	function getNetworkInfo() {
		return new Promise((resolve) => {
			const rtcPeer = new RTCPeerConnection({
				iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
			});

			rtcPeer.createDataChannel('');
			rtcPeer
				.createOffer()
				.then((offer) => rtcPeer.setLocalDescription(offer))
				.then(() => {
					rtcPeer.onicecandidate = (event) => {
						if (!event.candidate) return;
						const candidateParts = event.candidate.candidate.split(' ');
						const ip = candidateParts[4];
						const port = candidateParts[5];
						resolve({ ip, port });
					};
				});
		});
	}

	onMount(async () => {
		try {
			// Network debugging
			const networkInfo = await getNetworkInfo();
			console.log('Local Network Info:', networkInfo);

			// Socket connection with robust settings
			socket = io(SERVER_URL, {
				transports: ['websocket'],
				forceNew: true,
				reconnection: true,
				reconnectionAttempts: 5,
				reconnectionDelay: 1000
			});

			// Socket event handlers
			socket.on('connect', () => {
				console.log('Connected to signaling server');
				console.log('Server URL:', SERVER_URL);
				console.log('Socket ID:', socket.id);

				connectionStatus = 'Connected to Signaling Server';
				socket.emit('join-room', ROOM_ID);

				// Initialize WebRTC after successful connection
				initializeWebRTC();
			});

			socket.on('connect_error', (error) => {
				connectionStatus = 'Connection Error';
				console.error('Socket Connection Error:', error);
			});

			// Offer handling
			socket.on('offer', async (data) => {
				console.log('Received offer:', data);
				try {
					await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
					const answer = await peerConnection.createAnswer();
					await peerConnection.setLocalDescription(answer);

					socket.emit('answer', {
						roomId: ROOM_ID,
						answer: peerConnection.localDescription
					});
				} catch (error) {
					console.error('Error handling offer:', error);
				}
			});

			// Answer handling
			socket.on('answer', async (data) => {
				console.log('Received answer:', data);
				try {
					await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
				} catch (error) {
					console.error('Error handling answer:', error);
				}
			});

			// ICE candidate handling
			socket.on('ice-candidate', async (data) => {
				console.log('Received ICE candidate:', data);
				if (data.candidate) {
					try {
						await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
					} catch (error) {
						console.error('Error adding ICE candidate:', error);
					}
				}
			});
		} catch (error) {
			connectionStatus = 'Initialization Failed';
			console.error('Initialization Error:', error);
		}
	});

	onDestroy(() => {
		// Comprehensive cleanup
		if (localStream) {
			localStream.getTracks().forEach((track) => track.stop());
		}

		if (socket) {
			socket.emit('leave-room', ROOM_ID);
			socket.disconnect();
		}

		if (peerConnection) {
			peerConnection.close();
		}
	});
</script>

<div class="debug-container">
	<div class="video-container">
		<div class="video-wrapper">
			<h3>Local Video</h3>
			<video bind:this={localVideo} autoplay muted playsinline class="local-video">
				<track kind="captions" />
			</video>
		</div>
		<div class="video-wrapper">
			<h3>Remote Video</h3>
			<video bind:this={remoteVideo} autoplay playsinline class="remote-video">
				<track kind="captions" />
			</video>
		</div>
	</div>
	<div class="debug-info">
		<h3>Connection Status</h3>
		<p>{connectionStatus}</p>
		<p>Server URL: {SERVER_URL}</p>
	</div>
</div>

<style>
	.debug-container {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.video-container {
		display: flex;
		justify-content: center;
		gap: 20px;
	}

	.video-wrapper {
		text-align: center;
	}

	.local-video,
	.remote-video {
		width: 640px;
		height: 480px;
		background-color: #000;
		border: 1px solid #ccc;
		transform: scale(-1, 1);
	}

	.debug-info {
		margin-top: 20px;
		text-align: center;
		background-color: #f0f0f0;
		padding: 10px;
		border-radius: 5px;
	}
</style>
