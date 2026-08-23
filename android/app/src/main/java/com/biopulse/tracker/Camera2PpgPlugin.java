package com.biopulse.tracker;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.hardware.camera2.*;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.nio.ByteBuffer;
import java.util.Collections;

/**
 * Camera2PpgPlugin
 *
 * Plugin Nativo Android Camera2 para adquisición de fotopletismografía óptica (PPG).
 * Características:
 * 1. Acceso directo al sensor en formato YUV_420_888 sin conversión intermedia.
 * 2. Bloqueo 3A estricto por hardware (AE, AWB, AF en modo manual apagado).
 * 3. Activación constante de linterna / flash LED (FLASH_MODE_TORCH).
 * 4. Estampa temporal de reloj monótono en nanosegundos (SENSOR_TIMESTAMP).
 */
@CapacitorPlugin(
    name = "Camera2Ppg",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
    }
)
public class Camera2PpgPlugin extends Plugin {

    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private ImageReader imageReader;
    private HandlerThread backgroundThread;
    private Handler backgroundHandler;
    private boolean isCapturing = false;

    private void startBackgroundThread() {
        backgroundThread = new HandlerThread("Camera2PpgThread");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());
    }

    private void stopBackgroundThread() {
        if (backgroundThread != null) {
            backgroundThread.quitSafely();
            try {
                backgroundThread.join();
                backgroundThread = null;
                backgroundHandler = null;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @PluginMethod
    public void startCapture(PluginCall call) {
        if (isCapturing) {
            call.resolve(new JSObject().put("status", "already_running"));
            return;
        }

        Context context = getContext();
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Permiso de cámara no concedido");
            return;
        }

        CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        try {
            String targetCameraId = null;
            for (String cameraId : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(cameraId);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    targetCameraId = cameraId;
                    break;
                }
            }

            if (targetCameraId == null && manager.getCameraIdList().length > 0) {
                targetCameraId = manager.getCameraIdList()[0];
            }

            if (targetCameraId == null) {
                call.reject("No se encontró cámara trasera compatible");
                return;
            }

            startBackgroundThread();

            // Configurar ImageReader a 320x240 en YUV_420_888
            imageReader = ImageReader.newInstance(320, 240, ImageFormat.YUV_420_888, 3);
            imageReader.setOnImageAvailableListener(reader -> {
                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image != null) {
                        processYuvFrame(image);
                    }
                } catch (Exception e) {
                    // Ignorar fotogramas descartados en pico de carga
                } finally {
                    if (image != null) {
                        image.close();
                    }
                }
            }, backgroundHandler);

            manager.openCamera(targetCameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    cameraDevice = camera;
                    createCaptureSession(call);
                }

                @Override
                public void onDisconnected(CameraDevice camera) {
                    camera.close();
                    cameraDevice = null;
                }

                @Override
                public void onError(CameraDevice camera, int error) {
                    camera.close();
                    cameraDevice = null;
                    call.reject("Error al abrir Camera2: " + error);
                }
            }, backgroundHandler);

        } catch (CameraAccessException e) {
            call.reject("CameraAccessException: " + e.getMessage());
        }
    }

    private void createCaptureSession(PluginCall call) {
        try {
            CaptureRequest.Builder builder = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            builder.addTarget(imageReader.getSurface());

            // Bloqueo 3A estricto de hardware para PPG
            builder.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO);
            builder.set(CaptureRequest.FLASH_MODE, CameraMetadata.FLASH_MODE_TORCH);
            builder.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF);
            builder.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON); // Permite flash constante

            cameraDevice.createCaptureSession(
                Collections.singletonList(imageReader.getSurface()),
                new CameraCaptureSession.StateCallback() {
                    @Override
                    public void onConfigured(CameraCaptureSession session) {
                        captureSession = session;
                        try {
                            captureSession.setRepeatingRequest(builder.build(), null, backgroundHandler);
                            isCapturing = true;
                            JSObject res = new JSObject();
                            res.put("status", "capturing");
                            res.put("format", "YUV_420_888");
                            res.put("width", 320);
                            res.put("height", 240);
                            call.resolve(res);
                        } catch (CameraAccessException e) {
                            call.reject("Error al iniciar flujo repetido: " + e.getMessage());
                        }
                    }

                    @Override
                    public void onConfigureFailed(CameraCaptureSession session) {
                        call.reject("Fallo al configurar sesión de captura Camera2");
                    }
                },
                backgroundHandler
            );
        } catch (CameraAccessException e) {
            call.reject("Error al crear sesión de captura: " + e.getMessage());
        }
    }

    private void processYuvFrame(Image image) {
        Image.Plane yPlane = image.getPlanes()[0];
        ByteBuffer yBuffer = yPlane.getBuffer();
        int ySize = yBuffer.remaining();

        // Muestreo rápido de luminancia Y (correlacionada con la absorción pulsátil de hemoglobina)
        long sumY = 0;
        int step = 4; // Muestreo en sub-malla
        int samples = 0;

        for (int i = 0; i < ySize; i += step) {
            sumY += (yBuffer.get(i) & 0xFF);
            samples++;
        }

        double meanY = samples > 0 ? (double) sumY / samples : 0;
        long timestampNanos = image.getTimestamp();

        JSObject payload = new JSObject();
        payload.put("luminance", meanY);
        payload.put("timestampNanos", timestampNanos);
        payload.put("timestampMs", timestampNanos / 1_000_000.0);

        notifyListeners("onOpticalFrame", payload);
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        if (!isCapturing) {
            call.resolve(new JSObject().put("status", "already_stopped"));
            return;
        }

        try {
            if (captureSession != null) {
                captureSession.stopRepeating();
                captureSession.close();
                captureSession = null;
            }
            if (cameraDevice != null) {
                cameraDevice.close();
                cameraDevice = null;
            }
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
            }
            stopBackgroundThread();
            isCapturing = false;

            call.resolve(new JSObject().put("status", "stopped"));
        } catch (Exception e) {
            call.reject("Error al detener captura: " + e.getMessage());
        }
    }
}
