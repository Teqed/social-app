#!/usr/bin/env nix-shell
#!nix-shell -i bash -p go

tar -xzf "/tmp/shatteredsky-social/shatteredskyweb.tar.gz" -C "/opt/shatteredsky-social/" --strip-components=1 --overwrite
sudo systemctl restart shatteredsky-social.service
