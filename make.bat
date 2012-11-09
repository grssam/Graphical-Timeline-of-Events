@echo off
echo Making GT
\progra~1\7-zip\7z a -tzip -mx9 -r "Graphical Timeline of Events.xpi" content locale scripts skin bootstrap.js chrome.manifest install.rdf > nul
