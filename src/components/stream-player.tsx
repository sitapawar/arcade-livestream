import { useCopyToClipboard } from "@/lib/clipboard";
import { ParticipantMetadata, RoomMetadata } from "@/lib/controller";
import {
  AudioTrack,
  StartAudio,
  VideoTrack,
  useDataChannel,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { CopyIcon, EyeClosedIcon, EyeOpenIcon } from "@radix-ui/react-icons";
import { Avatar, Badge, Button, Flex, Grid, Text } from "@radix-ui/themes";
import Confetti from "js-confetti";
import {
  ConnectionState,
  LocalVideoTrack,
  Track,
  createLocalTracks,
  createLocalScreenTracks,
} from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { MediaDeviceSettings } from "./media-device-settings";
import { PresenceDialog } from "./presence-dialog";
import { useAuthToken } from "./token-context";

function ConfettiCanvas() {
  const [confetti, setConfetti] = useState<Confetti>();
  const [decoder] = useState(() => new TextDecoder());
  const canvasEl = useRef<HTMLCanvasElement>(null);

  useDataChannel("reactions", (data) => {
    const options: { emojis?: string[]; confettiNumber?: number } = {};
    if (decoder.decode(data.payload) !== "🎉") {
      options.emojis = [decoder.decode(data.payload)];
      options.confettiNumber = 12;
    }
    confetti?.addConfetti(options);
  });

  useEffect(() => {
    setConfetti(new Confetti({ canvas: canvasEl?.current ?? undefined }));
  }, []);

  return <canvas ref={canvasEl} className="absolute h-full w-full" />;
}

export function StreamPlayer({ isHost = false }) {
  const [_, copy] = useCopyToClipboard();
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack>();
  const [screenTrack, setScreenTrack] = useState<LocalVideoTrack | null>(null);
  const localVideoEl = useRef<HTMLVideoElement>(null);

  const { metadata, name: roomName, state: roomState } = useRoomContext();
  const roomMetadata = (metadata && JSON.parse(metadata)) as RoomMetadata;
  const { localParticipant } = useLocalParticipant();
  const localMetadata = (localParticipant.metadata &&
    JSON.parse(localParticipant.metadata)) as ParticipantMetadata;
  const canHost =
    isHost || (localMetadata?.invited_to_stage && localMetadata?.hand_raised);
  const participants = useParticipants();

  const showNotification = isHost
    ? participants.some((p) => {
        const metadata = (p.metadata &&
          JSON.parse(p.metadata)) as ParticipantMetadata;
        return metadata?.hand_raised && !metadata?.invited_to_stage;
      })
    : localMetadata?.invited_to_stage && !localMetadata?.hand_raised;

  // 🎥 Setup camera + mic
// ✅ Camera lifecycle management
useEffect(() => {
  let camTrack: LocalVideoTrack | undefined;

  const setupCamera = async () => {
    // Start camera only if host can broadcast and camera is enabled
    if (canHost && localParticipant.isCameraEnabled) {
      const tracks = await createLocalTracks({ video: true });
      camTrack = tracks.find(
        (t) => t.kind === Track.Kind.Video
      ) as LocalVideoTrack | undefined;

      if (camTrack && localVideoEl.current) {
        camTrack.attach(localVideoEl.current);
        await localParticipant.publishTrack(camTrack, {
          source: Track.Source.Camera,
          name: "camera",
        });
        setLocalVideoTrack(camTrack);
      }
    } else {
      // Turn camera off: unpublish and stop track
      if (localVideoTrack) {
        localParticipant.unpublishTrack(localVideoTrack);
        localVideoTrack.stop();
        setLocalVideoTrack(undefined);
      }
    }
  };

  void setupCamera();

  // Cleanup when camera toggles off or component unmounts
  return () => {
    if (camTrack) {
      localParticipant.unpublishTrack(camTrack);
      camTrack.stop();
      setLocalVideoTrack(undefined);
    }
  };
}, [canHost, localParticipant.isCameraEnabled]); // reacts to your existing toolbar button toggle

// ✅ Handle camera device changes
const { activeDeviceId: activeCameraDeviceId } = useMediaDeviceSelect({
  kind: "videoinput",
});

useEffect(() => {
  if (localVideoTrack && localParticipant.isCameraEnabled) {
    void localVideoTrack.setDeviceId(activeCameraDeviceId);
  }
}, [localVideoTrack, activeCameraDeviceId, localParticipant.isCameraEnabled]);

// 🎬 Remote participants (unchanged)
const remoteVideoTracks = useTracks([Track.Source.Camera]).filter(
  (t) => t.participant.identity !== localParticipant.identity
);
const remoteAudioTracks = useTracks([Track.Source.Microphone]).filter(
  (t) => t.participant.identity !== localParticipant.identity
);


  // 🖥️ Screen share handlers
  const startScreenShare = async () => {
    try {
      const tracks = await createLocalScreenTracks({ audio: false });
      const screen = tracks.find(
        (t) => t.kind === Track.Kind.Video
      ) as LocalVideoTrack | undefined;
      if (!screen) return;

      await localParticipant.publishTrack(screen, {
        source: Track.Source.ScreenShare,
        name: "screen",
      });
      setScreenTrack(screen);
    } catch (err) {
      console.error("Screen share failed:", err);
    }
  };

  const stopScreenShare = () => {
    if (!screenTrack) return;
    localParticipant.unpublishTrack(screenTrack);
    screenTrack.stop();
    setScreenTrack(null);
  };

  const authToken = useAuthToken();
  const onLeaveStage = async () => {
    await fetch("/api/remove_from_stage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${authToken}`,
      },
      body: JSON.stringify({ identity: localParticipant.identity }),
    });
  };

  // 🧱 UI
  return (
    <div className="relative h-full w-full bg-black">
      <Grid className="w-full h-full absolute" gap="2">
        {canHost && (
          <div className="relative">
            <Flex
              className="absolute w-full h-full"
              align="center"
              justify="center"
            >
              <Avatar
                size="9"
                fallback={localParticipant.identity[0] ?? "?"}
                radius="full"
              />
            </Flex>
            <video
              ref={localVideoEl}
              className="absolute w-full h-full object-contain -scale-x-100 bg-transparent"
            />
            <div className="absolute w-full h-full">
              <Badge
                variant="outline"
                color="gray"
                className="absolute bottom-2 right-2"
              >
                {localParticipant.identity} (you)
              </Badge>
            </div>
          </div>
        )}

        {remoteVideoTracks.map((t) => (
          <div key={t.participant.identity} className="relative">
            <Flex
              className="absolute w-full h-full"
              align="center"
              justify="center"
            >
              <Avatar
                size="9"
                fallback={t.participant.identity[0] ?? "?"}
                radius="full"
              />
            </Flex>
            <VideoTrack
              trackRef={t}
              className="absolute w-full h-full bg-transparent"
            />
            <div className="absolute w-full h-full">
              <Badge
                variant="outline"
                color="gray"
                className="absolute bottom-2 right-2"
              >
                {t.participant.identity}
              </Badge>
            </div>
          </div>
        ))}
      </Grid>

      {remoteAudioTracks.map((t) => (
        <AudioTrack trackRef={t} key={t.participant.identity} />
      ))}

      <ConfettiCanvas />
      <StartAudio
        label="Click to allow audio playback"
        className="absolute top-0 h-full w-full bg-gray-2-translucent text-white"
      />

      <div className="absolute top-0 w-full p-2">
        <Flex justify="between" align="end">
          <Flex gap="2" justify="center" align="center">
            <Button
              size="1"
              variant="soft"
              disabled={!Boolean(roomName)}
              onClick={() =>
                copy(`${process.env.NEXT_PUBLIC_SITE_URL}/watch/${roomName}`)
              }
            >
              {roomState === ConnectionState.Connected ? (
                <>
                  {roomName} <CopyIcon />
                </>
              ) : (
                "Loading..."
              )}
            </Button>

            {roomName && canHost && (
              <Flex gap="2">
                <MediaDeviceSettings />
                {roomMetadata?.creator_identity !==
                  localParticipant.identity && (
                  <Button size="1" onClick={onLeaveStage}>
                    Leave stage
                  </Button>
                )}
                <Button
                  size="1"
                  variant="soft"
                  onClick={screenTrack ? stopScreenShare : startScreenShare}
                >
                  {screenTrack ? "Stop Sharing" : "Share Screen"}
                </Button>
              </Flex>
            )}
          </Flex>

          <Flex gap="2">
            {roomState === ConnectionState.Connected && (
              <Flex gap="1" align="center">
                <div className="rounded-6 bg-red-9 w-2 h-2 animate-pulse" />
                <Text size="1" className="uppercase text-accent-11">
                  Live
                </Text>
              </Flex>
            )}

            <PresenceDialog isHost={isHost}>
              <div className="relative">
                {showNotification && (
                  <div className="absolute flex h-3 w-3 -top-1 -right-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-6 bg-accent-11 opacity-75"></span>
                    <span className="relative inline-flex rounded-6 h-3 w-3 bg-accent-11"></span>
                  </div>
                )}
                <Button
                  size="1"
                  variant="soft"
                  disabled={roomState !== ConnectionState.Connected}
                >
                  {roomState === ConnectionState.Connected ? (
                    <EyeOpenIcon />
                  ) : (
                    <EyeClosedIcon />
                  )}
                  {roomState === ConnectionState.Connected
                    ? participants.length
                    : ""}
                </Button>
              </div>
            </PresenceDialog>
          </Flex>
        </Flex>
      </div>
    </div>
  );
}
