#!/bin/bash
BTRADELOC=$(pwd)


BUILDLOC=prod
if [ "$1" = "dev" ]; then
   echo "Uploading to Track development Environment"
   TARGETSERVER=jayeesha@183.82.0.28
elif [ "$1" = "test" ]; then
   echo "Uploading to Track test Environment."
   TARGETSERVER=jayeesha@183.82.0.28
elif [ "$1" = "live" ]; then
   echo "Uploading to Track live Environment."
   TARGETSERVER=jayeesha@183.82.0.28
elif [ "$1" = "school" ]; then
   echo "Uploading to Track school Environment."
   TARGETSERVER=jayeesha@183.82.0.28
elif [ "$1" = "-h" ]; then
   echo "Usage : adminbuild.sh [test|live]"
   exit
else
   echo "Invalid argument"
   exit 1
fi

DATE=$(date +%Y-%m-%d-%H-%M)

cd $BTRADELOC

echo "Build Started .....🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️🏗️"
npm run build

if [ -d "$BTRADELOC/dist" ]; then
   cd dist
   echo "Creating tar.."
   tar -cvf ~/Downloads/executiveemailassistant.tar.xz *
   echo "Started Coping to Server................!©️©🗼🗼🗼🗼🗼🗼🗼🗼🗼🗼🗼🗼🗼🗼"

   if [ "$1" = "dev" ]; then
      scp ~/Downloads/executiveemailassistant.tar.xz $TARGETSERVER:
      echo "Extracting tar in server.."
      ssh $TARGETSERVER "cd /var/www/html/aimeetingassistant.dosystemsinc.com/public_html;sudo -S tar -xvf ~/executiveemailassistant.tar.xz"
      echo "Successfully uploaded to Track Dev"
   elif [ "$1" = "test" ]; then
      scp ~/Downloads/executiveemailassistant.tar.xz $TARGETSERVER:
      echo "Extracting tar File in server..  ✨✨✨✨✨✨✨✨✨✨✨✨"
      ssh $TARGETSERVER "cd /var/www/html/aimeetingassistant.dosystemsinc.com/public_html;sudo -S tar -xvf ~/executiveemailassistant.tar.xz"
      echo "Successfully Uploaded the Track Test 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀"
   elif [ "$1" = "live" ]; then
      scp ~/Downloads/executiveemailassistant.tar.xz $TARGETSERVER:
      echo "Extracting tar File in server..  ✨✨✨✨✨✨✨✨✨✨✨✨"
      ssh $TARGETSERVER "cd /var/www/html/aimeetingassistant.dosystemsinc.com/public_html;sudo -S tar -xvf ~/executiveemailassistant.tar.xz"
      echo "Successfully Uploaded the Track Live 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀"
   elif [ "$1" = "school" ]; then
      scp ~/Downloads/executiveemailassistant.tar.xz $TARGETSERVER:
      echo "Extracting tar File in server..  ✨✨✨✨✨✨✨✨✨✨✨✨"
      ssh $TARGETSERVER "cd /var/www/html/aimeetingassistant.dosystemsinc.com/public_html;sudo -S tar -xvf ~/executiveemailassistant.tar.xz"
      echo "Successfully Uploaded the Track Live 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀"
   fi
else
   echo "Build failed"
fi