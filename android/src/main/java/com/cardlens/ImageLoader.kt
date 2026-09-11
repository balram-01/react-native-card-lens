package com.cardlens

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import java.io.IOException

/**
 * Resolves a React Native image URI (file:// or content://) into an ML Kit
 * [InputImage].  Keeping this logic separate from [CardLensModule] makes both
 * classes individually unit-testable.
 *
 * Supported URI schemes:
 *  - `file://`    — standard filesystem path (camera captures, gallery copies)
 *  - `content://` — Android content-provider URI (MediaStore, Downloads, etc.)
 *
 * @throws IOException if the URI scheme is unsupported or the file cannot be opened.
 */
internal object ImageLoader {

    /**
     * Load an [InputImage] from a URI string.
     *
     * @param context  Android [Context] needed for content:// resolution.
     * @param uriString  The URI as a string, e.g. `"file:///data/user/0/..."`.
     * @return An [InputImage] ready to be passed to any ML Kit detector.
     */
    @Throws(IOException::class)
    fun fromUri(context: Context, uriString: String): InputImage {
        val uri = Uri.parse(uriString)
        return when (uri.scheme?.lowercase()) {
            "file" -> {
                // file:// — direct filesystem path
                InputImage.fromFilePath(context, uri)
            }
            "content" -> {
                // content:// — MediaStore or FileProvider URI
                InputImage.fromFilePath(context, uri)
            }
            else -> throw IOException(
                "Unsupported URI scheme '${uri.scheme}'. " +
                "CardLens only accepts file:// or content:// URIs."
            )
        }
    }
}
