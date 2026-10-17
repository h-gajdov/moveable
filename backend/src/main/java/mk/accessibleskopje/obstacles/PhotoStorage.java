package mk.accessibleskopje.obstacles;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.UUID;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;

import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import mk.accessibleskopje.common.ApiException;
import mk.accessibleskopje.config.AppProperties;

/**
 * Validates and stores report photos. Every upload is decoded and re-encoded as
 * JPEG, which strips all metadata (including EXIF GPS location and device
 * details) and neutralises polyglot/malicious files. Only JPEG and PNG input is
 * accepted, verified by magic bytes rather than the client-declared type.
 */
@Component
public class PhotoStorage {

    private static final long MAX_PIXELS = 40_000_000L;

    private final Path dir;
    private final long maxBytes;
    private final int maxDimension;

    public PhotoStorage(AppProperties props) throws IOException {
        this.dir = Path.of(props.uploads().dir()).toAbsolutePath().normalize();
        this.maxBytes = props.uploads().maxBytes();
        this.maxDimension = props.uploads().maxDimensionPx();
        Files.createDirectories(dir);
    }

    public String store(MultipartFile file) {
        if (file.getSize() > maxBytes) {
            throw new ApiException(org.springframework.http.HttpStatus.CONTENT_TOO_LARGE, "PHOTO_TOO_LARGE",
                    "The photo is too large.");
        }
        byte[] data;
        try {
            data = file.getBytes();
        } catch (IOException e) {
            throw ApiException.badRequest("PHOTO_INVALID", "The photo could not be read.");
        }
        if (!isJpeg(data) && !isPng(data)) {
            throw ApiException.badRequest("PHOTO_UNSUPPORTED_TYPE", "Only JPEG and PNG photos are accepted.");
        }
        BufferedImage image = decode(data);
        BufferedImage scaled = scale(image);
        String name = UUID.randomUUID() + ".jpg";
        Path target = dir.resolve(name).normalize();
        if (!target.startsWith(dir)) {
            throw new IllegalStateException("path traversal");
        }
        try (OutputStream out = Files.newOutputStream(target)) {
            writeJpeg(scaled, out);
        } catch (IOException e) {
            throw new IllegalStateException("could not store photo", e);
        }
        return name;
    }

    public Path resolve(String name) {
        Path p = dir.resolve(name).normalize();
        if (!p.startsWith(dir) || !Files.isRegularFile(p)) {
            throw ApiException.notFound("PHOTO_NOT_FOUND", "Photo not found.");
        }
        return p;
    }

    static boolean isJpeg(byte[] d) {
        return d.length > 3 && (d[0] & 0xFF) == 0xFF && (d[1] & 0xFF) == 0xD8 && (d[2] & 0xFF) == 0xFF;
    }

    static boolean isPng(byte[] d) {
        return d.length > 8 && (d[0] & 0xFF) == 0x89 && d[1] == 'P' && d[2] == 'N' && d[3] == 'G';
    }

    private BufferedImage decode(byte[] data) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) {
                throw ApiException.badRequest("PHOTO_INVALID", "The photo could not be read.");
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                // Check dimensions before decoding to prevent decompression bombs.
                long pixels = (long) reader.getWidth(0) * reader.getHeight(0);
                if (pixels > MAX_PIXELS) {
                    throw ApiException.badRequest("PHOTO_TOO_LARGE_DIMENSIONS", "The photo resolution is too high.");
                }
                return reader.read(0);
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            if (e instanceof ApiException ae) {
                throw ae;
            }
            throw ApiException.badRequest("PHOTO_INVALID", "The photo could not be read.");
        }
    }

    private BufferedImage scale(BufferedImage src) {
        double f = Math.min(1.0, (double) maxDimension / Math.max(src.getWidth(), src.getHeight()));
        int w = Math.max(1, (int) Math.round(src.getWidth() * f));
        int h = Math.max(1, (int) Math.round(src.getHeight() * f));
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setColor(java.awt.Color.WHITE);
        g.fillRect(0, 0, w, h);
        g.drawImage(src, 0, 0, w, h, null);
        g.dispose();
        return out;
    }

    private static void writeJpeg(BufferedImage img, OutputStream out) throws IOException {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        try (ImageOutputStream ios = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(ios);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(0.85f);
            writer.write(null, new IIOImage(img, null, null), param);
        } finally {
            writer.dispose();
        }
    }
}
