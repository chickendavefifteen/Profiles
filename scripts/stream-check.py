import sys
d = open('/tmp/verify-stream.bin', 'rb').read()
parts = d.split(b'Content-Type: image/jpeg')
if len(parts) < 2:
    print('frames=0 bytes=%d' % len(d))
    sys.exit(1)
img = parts[-1].split(b'\r\n\r\n', 1)[1]
ok = img[:2] == b'\xff\xd8'
print('frames=%d jpeg=%s bytes=%d' % (len(parts) - 1, ok, len(d)))
sys.exit(0 if ok else 1)
