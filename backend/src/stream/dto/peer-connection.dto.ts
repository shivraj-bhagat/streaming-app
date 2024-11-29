export class PeerConnectionDto {
  roomId: string;
  peerId: string;
  sdp?: RTCSessionDescription;
  candidate?: RTCIceCandidate;
}
