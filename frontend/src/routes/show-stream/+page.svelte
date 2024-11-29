<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import io, { Socket } from 'socket.io-client';

	let socket: Socket;
	let localVideo: HTMLVideoElement;
	let remoteVideo: HTMLVideoElement;
	let peerConnection: RTCPeerConnection;
	const roomId = 'test-room';

	const configuration = {
		iceServers: [
			{ urls: 'stun:stun.l.google.com:19302' },
			{
				urls: 'turn:your-turn-server.com',
				username: 'optional-username',
				credential: 'optional-password'
			}
		]
	};

	onMount(async () => {
		try {
			socket = io('http://localhost:3010', {
				transports: ['websocket'],
				timeout: 5000,
				reconnection: true,
				reconnectionAttempts: 3
			});

			socket.on('connect_error', (error) => console.error('Connection error:', error));

			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
				localVideo.srcObject = stream;

				// Create PeerConnection and add tracks
				peerConnection = new RTCPeerConnection(configuration);
				stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
			} catch (error) {
				console.error('Error accessing media devices:', error);
				return;
			}

			// Join room and set up socket listeners
			socket.on('connect', () => {
				console.log('Connected to server, joining room:', roomId);
				socket.emit('join-room', roomId);
			});

			socket.on('offer', async (data) => {
				console.log('Received offer:', data);
				try {
					await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
					const answer = await peerConnection.createAnswer();
					await peerConnection.setLocalDescription(answer);
					socket.emit('answer', { roomId, answer: peerConnection.localDescription });
				} catch (error) {
					console.error('Error handling offer:', error);
				}
			});

			socket.on('answer', async (data) => {
				console.log('Received answer:', data);
				try {
					await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
				} catch (error) {
					console.error('Error handling answer:', error);
				}
			});

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

			peerConnection.onicecandidate = (event) => {
				if (event.candidate) {
					socket.emit('ice-candidate', { roomId, candidate: event.candidate });
				}
			};

			peerConnection.ontrack = (event) => {
				console.log('Received remote track:', event);
				remoteVideo.srcObject = event.streams[0];
			};
		} catch (error) {
			console.error('Initialization error:', error);
		}
	});

	onDestroy(() => {
		if (socket) {
			socket.emit('leave-room', roomId);
			socket.disconnect();
		}
		if (peerConnection) {
			peerConnection.close();
		}
	});
</script>

<div class="video-container">
	<video bind:this={localVideo} autoplay muted playsinline>
		<track kind="captions" />
	</video>
	<video bind:this={remoteVideo} autoplay playsinline>
		<track kind="captions" />
	</video>
</div>
