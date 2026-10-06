import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Camera, Check, ImagePlus, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import {
  useProfile,
  useSetAvatarPreset,
  useUploadAvatar,
} from '@/services/profileService';
import { useToast } from '@/hooks/use-toast';
import { UserAvatar } from '@/components/chat/UserAvatar';
import { AvatarPresetIcon } from '@/components/avatar/AvatarPresetIcon';
import { ActivityIndicator } from '@/components/brand';
import { AVATAR_PRESETS, type AvatarPresetId } from '@shared/avatarPresets';
import { cn } from '@/lib/utils';
import { ssoManaged } from '@/lib/supabase';

export const AvatarUpdateDialog = ({ className }: { className?: string }) => {
  const { data: profile } = useProfile();
  const { mutate: uploadAvatar, isPending: isUploadingAvatar } =
    useUploadAvatar();
  const { mutate: setAvatarPreset, isPending: isSettingPreset } =
    useSetAvatarPreset();
  const { toast } = useToast();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Avatar crop state
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = isUploadingAvatar || isSettingPreset;
  const selectedPreset = profile?.avatar_preset ?? null;

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setSelectedImageUrl(objectUrl);
    setIsPickerOpen(false);
    setIsCropOpen(true);
  };

  const onCropComplete = (
    _croppedArea: { width: number; height: number; x: number; y: number },
    croppedPixels: { width: number; height: number; x: number; y: number },
  ) => {
    setCroppedAreaPixels(croppedPixels);
  };

  async function getCroppedBlob(
    imageSrc: string,
    cropPixels: { x: number; y: number; width: number; height: number },
    outputSize = 512,
  ): Promise<Blob> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageSrc;
    });

    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      image,
      cropPixels.x,
      cropPixels.y,
      cropPixels.width,
      cropPixels.height,
      0,
      0,
      outputSize,
      outputSize,
    );

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        },
        'image/jpeg',
        0.92,
      );
    });
  }

  const handleCropCancel = () => {
    if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
    setSelectedImageUrl(null);
    setIsCropOpen(false);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropSave = async () => {
    try {
      if (!selectedImageUrl || !croppedAreaPixels) return;
      const blob = await getCroppedBlob(
        selectedImageUrl,
        croppedAreaPixels,
        512,
      );
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });

      uploadAvatar(file, {
        onSuccess: () => {
          toast({
            title: 'Profile picture updated',
            description: 'Your uploaded picture is now your active avatar.',
          });
        },
        onError: (error) => {
          console.error('Error uploading avatar:', error);
          toast({
            title: 'Upload failed',
            description:
              error instanceof Error
                ? error.message
                : 'Failed to upload profile picture. Please try again.',
            variant: 'destructive',
          });
        },
        onSettled: handleCropCancel,
      });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Crop failed',
        description: 'Unable to crop image. Please try another image.',
        variant: 'destructive',
      });
    }
  };

  const choosePreset = (preset: AvatarPresetId | null) => {
    setAvatarPreset(preset, {
      onSuccess: () => {
        setIsPickerOpen(false);
        toast({
          title: preset ? 'Avatar icon selected' : 'Profile photo selected',
          description: preset
            ? 'Your selected Brepia avatar icon is now active.'
            : ssoManaged
              ? 'Brepia will use your account or social profile photo.'
              : 'Brepia will use your uploaded photo or initials.',
        });
      },
      onError: (error) => {
        toast({
          title: 'Avatar update failed',
          description:
            error instanceof Error ? error.message : 'Failed to update avatar.',
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <>
      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={handleAvatarUpload}
          className="hidden"
        />
        <button
          type="button"
          aria-label="Change avatar"
          onClick={() => setIsPickerOpen(true)}
          className="group relative block rounded-full"
        >
          <UserAvatar
            className={cn(
              'h-9 w-9 border border-adam-neutral-700 bg-adam-neutral-950 p-0',
              className,
            )}
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {isBusy ? (
              <ActivityIndicator
                label="Updating avatar"
                size="sm"
                dotClassName="bg-white"
              />
            ) : (
              <Camera className="h-4 w-4 text-white" />
            )}
          </span>
        </button>
      </div>

      <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[420px] overflow-y-auto border-adam-neutral-800 p-5 sm:rounded-2xl sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-adam-neutral-50">
              Choose avatar
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-adam-neutral-300">
                Profile photo
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => choosePreset(null)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  selectedPreset === null
                    ? 'border-adam-blue bg-adam-blue/10'
                    : 'border-adam-neutral-800 hover:bg-adam-neutral-800/50',
                )}
              >
                <UserAvatar className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-adam-neutral-50">
                    {ssoManaged
                      ? 'Account / social photo'
                      : 'Uploaded photo / initials'}
                  </div>
                  <div className="mt-0.5 text-xs text-adam-neutral-400">
                    {ssoManaged
                      ? 'Use the picture supplied by your sign-in provider.'
                      : profile?.avatar_path
                        ? 'Use your currently uploaded profile picture.'
                        : 'Use the standard initials avatar.'}
                  </div>
                </div>
                {selectedPreset === null ? (
                  <Check className="h-5 w-5 shrink-0 text-adam-blue" />
                ) : (
                  <RotateCcw className="h-4 w-4 shrink-0 text-adam-neutral-400" />
                )}
              </button>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-adam-neutral-300">
                Brepia icons
              </div>
              <div className="grid grid-cols-4 gap-2">
                {AVATAR_PRESETS.map((preset) => {
                  const selected = selectedPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.label}
                      aria-label={`Use ${preset.label} avatar`}
                      aria-pressed={selected}
                      disabled={isBusy}
                      onClick={() => choosePreset(preset.id)}
                      className={cn(
                        'relative h-12 w-12 justify-self-center rounded-full border transition-all',
                        'flex shrink-0 items-center justify-center',
                        selected
                          ? 'border-adam-blue bg-adam-blue/15 text-adam-blue ring-2 ring-adam-blue/30'
                          : 'border-adam-neutral-700 bg-adam-neutral-800 text-adam-neutral-100 hover:border-adam-neutral-500 hover:bg-adam-neutral-700',
                      )}
                    >
                      <AvatarPresetIcon
                        preset={preset.id}
                        className="h-5 w-5 stroke-[1.8]"
                      />
                      {selected ? (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-adam-blue text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {!ssoManaged ? (
              <div className="border-t border-adam-neutral-800 pt-4">
                <Button
                  type="button"
                  variant="dark"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-full"
                >
                  <ImagePlus className="mr-2 h-4 w-4" />
                  Upload custom picture
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCropOpen}
        onOpenChange={(open) =>
          open ? setIsCropOpen(true) : handleCropCancel()
        }
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] border-adam-neutral-800 sm:rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-adam-neutral-50">
              Crop profile picture
            </DialogTitle>
          </DialogHeader>
          <div className="relative h-72 w-full overflow-hidden rounded-md bg-black/20">
            {selectedImageUrl && (
              <Cropper
                image={selectedImageUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                cropShape="round"
                showGrid={false}
              />
            )}
          </div>
          <div className="mt-4">
            <div className="mb-2 text-xs text-adam-neutral-200">Zoom</div>
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.1}
              onValueChange={(value) => setZoom(value[0] ?? 1)}
            />
          </div>
          <DialogFooter className="grid w-full grid-cols-2 gap-5 sm:space-x-0">
            <Button
              variant="dark"
              onClick={handleCropCancel}
              className="w-full rounded-full font-light"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCropSave}
              disabled={isUploadingAvatar}
              variant="light"
              className="w-full rounded-full font-light"
            >
              {isUploadingAvatar ? (
                <div className="flex items-center gap-2">
                  <ActivityIndicator label="Saving profile picture" size="sm" />
                  Saving...
                </div>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
