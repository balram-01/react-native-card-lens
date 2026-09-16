package com.cardlens

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.google.mlkit.vision.common.InputImage
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Resolves a React Native image or PDF URI (file:// or content://) into an ML Kit [InputImage]
 * or Android [Bitmap].
 *
 * Automatically renders multi-page PDF documents into crisp, high-resolution PNG page images
 * via Android's native [PdfRenderer].
 *
 * Automatically caps oversized bitmaps (e.g. 12-48MP raw camera captures)
 * to a maximum dimension of ~2048px before feeding into ML Kit.
 */
internal object ImageLoader {

    private const val MAX_OCR_DIMENSION = 2048

    fun isPdf(context: Context, uri: Uri): Boolean {
        return try {
            val type = context.contentResolver.getType(uri)
            if (type?.contains("pdf", ignoreCase = true) == true) return true
            val path = uri.path ?: uri.toString()
            path.endsWith(".pdf", ignoreCase = true)
        } catch (_: Exception) {
            false
        }
    }

    @Throws(IOException::class)
    fun copyToCache(context: Context, uri: Uri): String {
        val ext = when (context.contentResolver.getType(uri)) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            else -> "jpg"
        }
        val cacheFile = File(context.cacheDir, "picked_img_${System.currentTimeMillis()}.$ext")
        openStream(context, uri).use { input ->
            FileOutputStream(cacheFile).use { output ->
                input.copyTo(output)
            }
        }
        return Uri.fromFile(cacheFile).toString()
    }

    @Throws(IOException::class)
    fun renderPdfToImages(context: Context, uri: Uri): List<String> {
        val pageUris = mutableListOf<String>()
        val tempPdf = File(context.cacheDir, "temp_pdf_${System.currentTimeMillis()}.pdf")
        try {
            openStream(context, uri).use { input ->
                FileOutputStream(tempPdf).use { output ->
                    input.copyTo(output)
                }
            }

            val pfd = ParcelFileDescriptor.open(tempPdf, ParcelFileDescriptor.MODE_READ_ONLY)
            val renderer = PdfRenderer(pfd)
            val pageCount = renderer.pageCount
            val outputDir = File(context.cacheDir, "pdf_pages_${System.currentTimeMillis()}").apply { mkdirs() }

            for (i in 0 until pageCount) {
                val page = renderer.openPage(i)
                // Target ~1800-2400px width/height for maximum OCR fidelity on business cards
                val scale = max(2.0f, min(3.5f, 2400f / max(page.width, page.height).toFloat()))
                val targetW = (page.width * scale).toInt()
                val targetH = (page.height * scale).toInt()

                val bitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                canvas.drawColor(Color.WHITE)

                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                page.close()

                val outFile = File(outputDir, "page_${i + 1}.png")
                FileOutputStream(outFile).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
                pageUris.add(Uri.fromFile(outFile).toString())
            }
            renderer.close()
            pfd.close()
        } finally {
            if (tempPdf.exists()) tempPdf.delete()
        }
        return pageUris
    }

    @Throws(IOException::class)
    fun fromUri(context: Context, uriString: String): InputImage {
        val uri = Uri.parse(uriString)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "file" && scheme != "content") {
            throw IOException(
                "Unsupported URI scheme '${uri.scheme}'. " +
                "CardLens only accepts file:// or content:// URIs."
            )
        }

        // Automatic PDF conversion
        if (isPdf(context, uri)) {
            val pages = renderPdfToImages(context, uri)
            if (pages.isNotEmpty()) {
                return fromUri(context, pages[0])
            }
        }

        // 1. Measure dimensions without decoding pixel buffer into RAM
        val boundsOptions = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        openStream(context, uri).use { input ->
            BitmapFactory.decodeStream(input, null, boundsOptions)
        }

        val width = boundsOptions.outWidth
        val height = boundsOptions.outHeight

        // If bounds couldn't be decoded or image is already <= MAX_OCR_DIMENSION, use direct fast-path
        if (width <= 0 || height <= 0 || (width <= MAX_OCR_DIMENSION && height <= MAX_OCR_DIMENSION)) {
            return InputImage.fromFilePath(context, uri)
        }

        // 2. Compute inSampleSize power-of-two downsampling
        val maxDim = max(width, height)
        var sampleSize = 1
        while ((maxDim / (sampleSize * 2)) >= MAX_OCR_DIMENSION) {
            sampleSize *= 2
        }

        val decodeOptions = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }

        val bitmap: Bitmap = openStream(context, uri).use { input ->
            BitmapFactory.decodeStream(input, null, decodeOptions)
        } ?: return InputImage.fromFilePath(context, uri)

        // 3. Read EXIF orientation to preserve correct rotation
        val rotationDegrees = getRotationDegrees(context, uri)

        return InputImage.fromBitmap(bitmap, rotationDegrees)
    }

    @Throws(IOException::class)
    fun loadBitmap(context: Context, uriString: String): Bitmap {
        val uri = Uri.parse(uriString)

        // Automatic PDF conversion
        if (isPdf(context, uri)) {
            val pages = renderPdfToImages(context, uri)
            if (pages.isNotEmpty()) {
                return loadBitmap(context, pages[0])
            }
        }

        val rotationDegrees = getRotationDegrees(context, uri)

        val decodeOptions = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = openStream(context, uri).use { input ->
            BitmapFactory.decodeStream(input, null, decodeOptions)
        } ?: throw IOException("Failed to decode bitmap from $uriString")

        if (rotationDegrees == 0) return bitmap

        val matrix = Matrix().apply {
            postRotate(rotationDegrees.toFloat())
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun openStream(context: Context, uri: Uri): InputStream {
        return context.contentResolver.openInputStream(uri)
            ?: throw IOException("Cannot open input stream for $uri")
    }

    private fun getRotationDegrees(context: Context, uri: Uri): Int {
        return try {
            openStream(context, uri).use { input ->
                val exif = ExifInterface(input)
                when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
                    else -> 0
                }
            }
        } catch (_: Exception) {
            0
        }
    }
}

