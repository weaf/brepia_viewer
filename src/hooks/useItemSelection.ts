import { useSelectedItems } from '@/contexts/SelectedItemsContext';
import { useConversation } from '@/contexts/ConversationContext';
import {
  NATIVE_CREATIVE_MESH_MODEL_ID,
  getCreativeMeshModelDefinition,
  normalizeCreativeMeshModelId,
} from '@shared/creativeMeshModels';
import { MessageItem } from '../types/misc.ts';
import { useCallback, type Dispatch, type SetStateAction } from 'react';

export function useItemSelection() {
  const { images, setImages: setImagesRaw, mesh, setMesh } = useSelectedItems();
  const { conversation } = useConversation();

  const selectedCreativeModel =
    conversation.type === 'creative'
      ? (normalizeCreativeMeshModelId(conversation.settings?.model) ??
        NATIVE_CREATIVE_MESH_MODEL_ID)
      : null;
  const maxReferenceImages = selectedCreativeModel
    ? getCreativeMeshModelDefinition(selectedCreativeModel)?.maxReferenceImages
    : undefined;

  const setImages: Dispatch<SetStateAction<MessageItem[]>> = useCallback(
    (action) => {
      setImagesRaw((current) => {
        const next = typeof action === 'function' ? action(current) : action;
        if (
          conversation.type !== 'creative' ||
          maxReferenceImages === undefined ||
          next.length <= maxReferenceImages
        ) {
          return next;
        }

        // Keep selection deterministic and never let a transient over-limit
        // array trigger legacy model-switching behavior. The submit validator
        // remains the second line of defense for externally constructed parts.
        return next.slice(0, maxReferenceImages);
      });
    },
    [conversation.type, maxReferenceImages, setImagesRaw],
  );

  const selectItem = useCallback(
    (item: MessageItem, type: 'image' | 'mesh') => {
      if (type === 'image') {
        if (images.some((image) => image.id === item.id)) {
          const newSelectedImages = images.filter(
            (image) => image.id !== item.id,
          );
          setImages(newSelectedImages);
        } else {
          const newSelectedImages = [...images, item];
          setImages(newSelectedImages);
        }
      } else {
        // For meshes, we just toggle the selection
        setMesh(mesh?.id === item.id ? null : item);
      }
    },
    [images, mesh, setImages, setMesh],
  );

  return {
    images,
    mesh,
    selectItem,
    setImages,
    setMesh,
  };
}
