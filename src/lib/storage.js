import { supabase } from './supabase';

export async function uploadAvatar(file, uid) {
  const ext = file.name.split('.').pop() || 'png';
  const path = `avatars/${uid}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('media').getPublicUrl(path);
  return data.publicUrl;
}


// Helper: turn a public URL into a bucket-relative path
function toBucketRelativePath(publicUrl) {
  try {
    const u = new URL(publicUrl);
    // Example path: /storage/v1/object/public/media/avatars/123/file.png
    const prefix = '/storage/v1/object/public/';
    if (!u.pathname.startsWith(prefix)) return null;

    // "media/avatars/123/file.png"
    const after = u.pathname.slice(prefix.length);

    // Split → [ 'media', 'avatars', '123', 'file.png' ]
    const [bucket, ...pathParts] = after.split('/');
    if (bucket !== 'media' || pathParts.length === 0) return null;

    // ✅ Return only inside-bucket path: "avatars/123/file.png"
    return pathParts.join('/');
  } catch (err) {
    console.warn('Failed to parse URL:', publicUrl, err);
    return null;
  }
}

export async function deleteMediaFiles(urls) {
  try {
    console.log("deleteMediaFiles called with URLs:", urls);

    // Clean paths
    const filePaths = urls.map(toBucketRelativePath).filter(Boolean);

    console.log("Final file paths to delete (bucket-relative):", filePaths);

    if (filePaths.length === 0) {
      console.log('No valid file paths found for deletion');
      return { success: true, deleted: 0, failed: 0 };
    }

    let successfullyDeleted = 0;
    let failedToDelete = 0;

    for (const filePath of filePaths) {
      try {
        console.log(`Deleting file: ${filePath}`);

        // Directory portion (everything except filename)
        const dir = filePath.split('/').slice(0, -1).join('/');
        const fileName = filePath.split('/').pop();

        // First: check if file exists
        const { data: listData, error: listError } = await supabase
          .storage
          .from('media')
          .list(dir);

        if (listError) {
          console.error(`Error listing directory ${dir}:`, listError);
          failedToDelete++;
          continue;
        }

        const fileExists = listData?.some(f => f.name === fileName);
        if (!fileExists) {
          console.log(`File ${filePath} does not exist, skipping`);
          continue;
        }

        // Delete the file
        const { error: removeError } = await supabase
          .storage
          .from('media')
          .remove([filePath]);

        if (removeError) {
          console.error(`Failed to delete ${filePath}:`, removeError);
          failedToDelete++;
          continue;
        }

        // Optional: verify deletion
        await new Promise(resolve => setTimeout(resolve, 500));
        const { data: verifyData } = await supabase
          .storage
          .from('media')
          .list(dir);

        const stillExists = verifyData?.some(f => f.name === fileName);

        if (stillExists) {
          console.error(`File ${filePath} still exists after deletion attempt`);
          failedToDelete++;
        } else {
          console.log(`Successfully deleted ${filePath}`);
          successfullyDeleted++;
        }
      } catch (fileError) {
        console.error(`Error processing file ${filePath}:`, fileError);
        failedToDelete++;
      }
    }

    return {
      success: failedToDelete === 0,
      deleted: successfullyDeleted,
      failed: failedToDelete,
    };
  } catch (error) {
    console.error('Error in deleteMediaFiles:', error);
    throw error;
  }
}