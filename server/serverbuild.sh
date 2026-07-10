#!/bin/bash

# CTRADELOC=/var/www/html/crashcart/server
BUILDLOC=prod
BTRADELOC=$(pwd)


if [ "$1" = "test" ]; then
    echo "Uploading to test server.."
    TARGETSERVER=jayeesha@183.82.0.28
elif [ "$1" = "dev" ]; then
    echo "Uploading to test server.. ."
    TARGETSERVER=jayeesha@183.82.0.28
elif [ "$1" = "live" ]; then
    echo "Uploading to test server.. ."
    TARGETSERVER=jayeesha@183.82.0.28
fi

DATE=`date +%Y-%m-%d-%H-%M`

cd $BTRADELOC

tar -czf ~/Downloads/executiveemail.tar.gz --exclude 'node_modules' server

if [ "$1" = "dev" ]; then
    scp ~/Downloads/executiveemail.tar.gz $TARGETSERVER:~/
    ssh $TARGETSERVER "cd /var/www/amnealemailpocapi.dosystemsinc.com/server/;  sudo -S tar -xzf ~/executiveemail.tar.gz; sudo -S chmod -R 777 server"
elif [ "$1" = "test" ]; then
    scp ~/Downloads/executiveemail.tar.gz $TARGETSERVER:~/
    ssh $TARGETSERVER "cd /var/www/amnealemailpocapi.dosystemsinc.com/server/;  sudo -S tar -xzf ~/executiveemail.tar.gz; sudo -S chmod -R 777 server"
elif [ "$1" = "live" ]; then
    scp ~/Downloads/executiveemail.tar.gz $TARGETSERVER:~/
    ssh $TARGETSERVER "cd /var/www/amnealemailpocapi.dosystemsinc.com/server/;  sudo -S tar -xzf ~/executiveemail.tar.gz; sudo -S chmod -R 777 server"
fi

echo "Successfully uploaded to server"