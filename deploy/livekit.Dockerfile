# Coolify runs the stack outside the repo clone, so a bind-mounted config
# resolves to a missing path and Docker substitutes an empty directory.
# Baking the file into the image keeps it under version control instead.
FROM livekit/livekit-server:v1.9.10
COPY deploy/livekit.coolify.yaml /etc/livekit/livekit.yaml
