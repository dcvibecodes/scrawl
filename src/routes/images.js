const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { requireOwner } = require('../middleware/auth');
const imageStore = require('../services/images');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

// Upload an image (owner only). Returns { url } for inserting into the editor.
router.post('/api/images', requireOwner, (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 10 MB limit.' : 'Upload failed.';
            return res.status(status).json({ success: false, error: message });
        }
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'No image received.' });
            const result = await imageStore.storeImage(req.file);
            res.json({ success: true, ...result });
        } catch (e) {
            res.status(e.status || 500).json({ success: false, error: e.message || 'Image processing failed.' });
        }
    });
});

// Serve uploaded images. Filenames are server-generated uuids — immutable, so cache hard.
router.get('/images/:file', (req, res) => {
    if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif)$/.test(req.params.file)) {
        return res.status(404).end();
    }
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.join(imageStore.UPLOADS_DIR, req.params.file));
});

// Delete an image (owner only) — used by the editor's remove button.
router.post('/api/images/delete/:id', requireOwner, async (req, res) => {
    try {
        const deleted = await imageStore.deleteImageById(req.params.id);
        res.json({ success: true, deleted });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;
