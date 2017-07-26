FROM sgr0502/tw-node-skel-gyp

ENV HOME=/home/app

#ADD https://letsencrypt.org/certs/lets-encrypt-x3-cross-signed.pem $HOME/
COPY ./src/ $HOME
WORKDIR $HOME

RUN set -x \
 && chmod +x $HOME/runnode \
 && update-ca-certificates \
# for raspi & raspi-i2c
 && apt-get update \
 && apt-get install -y sudo kmod \
 && npm install

CMD ["./runnode"]
