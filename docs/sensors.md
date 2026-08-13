# Capteurs locaux

Le MVP accepte des mesures HTTP sans Home Assistant ni cloud. Deux capteurs simulés permettent de construire le dashboard avant d’acheter du matériel.

## Contrat HTTP

`POST /api/v1/sensors/ingest`

En-têtes :

```text
Content-Type: application/json
X-HomeDash-Sensor: valeur de HOMEDASH_SENSOR_INGEST_TOKEN
```

Corps :

```json
{
  "id": "esp32-salon",
  "name": "Température salon",
  "type": "temperature",
  "location": "salon",
  "value": 21.6,
  "unit": "°C",
  "timestamp": "2026-08-12T18:30:00.000Z"
}
```

`id`, `type`, `location`, `value` et `unit` sont obligatoires ; `name` et `timestamp` sont optionnels. Un même `id` met à jour la ligne existante. HomeDash renvoie `202` et pousse la nouvelle valeur aux tablettes par WebSocket.

Test depuis un PC du LAN :

```powershell
$headers = @{ 'X-HomeDash-Sensor' = 'VOTRE_TOKEN' }
$body = @{ id='test-bureau'; name='Bureau'; type='temperature'; location='bureau'; value=22.3; unit='°C' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://homedash.home.arpa/api/v1/sensors/ingest' -Headers $headers -ContentType 'application/json' -Body $body
```

Ajoutez ensuite le widget **Température**, ouvrez sa configuration et sélectionnez le capteur.

## Matériel recommandé

Pour une première sonde :

- ESP32 DevKit (Wi-Fi plus simple et plus de marge qu’un ESP8266) ;
- SHT31/SHT35 pour une bonne précision, ou DHT22 pour un prototype moins cher ;
- boîtier ventilé, câble court et alimentation USB stable ;
- pour l’extérieur, boîtier IP65 avec écran solaire/abri Stevenson : ne placez pas la sonde au soleil direct.

L’exemple [esp32-temperature.ino](../examples/esp32-temperature/esp32-temperature.ino) utilise DHT22 et Arduino IDE.

## Installer l’exemple ESP32

1. Installez Arduino IDE.
2. Ajoutez le gestionnaire de cartes Espressif ESP32.
3. Installez la bibliothèque `DHT sensor library` d’Adafruit.
4. Copiez l’exemple dans un dossier extérieur au dépôt.
5. Renseignez SSID, mot de passe Wi-Fi, IP HomeDash et token capteur.
6. Branchez DATA du DHT22 sur GPIO 4, VCC sur 3,3 V, GND sur GND et ajoutez une résistance de rappel 10 kΩ si le module n’en contient pas.
7. Téléversez, ouvrez le moniteur série à 115200 bauds.
8. Vérifiez un code HTTP `202` toutes les 60 secondes.
9. Changez les secrets copiés dans le sketch si celui-ci a été partagé par erreur.

Le firmware d’exemple utilise HTTP sur `192.168.1.124:4100` car la gestion d’une CA privée sur microcontrôleur demande d’embarquer le certificat. Nginx n’expose sur ce port que `POST /api/v1/sensors/ingest` et refuse les autres routes. Le token circule néanmoins en clair : pour un réseau IoT non fiable, ajoutez la CA HomeDash à `WiFiClientSecure` ou placez les objets dans un VLAN isolé qui ne peut atteindre que ce port du Pi.

## États et valeurs obsolètes

Un capteur reçu est `online`. La prochaine étape de stabilisation doit ajouter une politique d’expiration par type (par exemple `stale` après 3 minutes, `offline` après 15 minutes). Le timestamp affiché permet déjà de détecter une mesure ancienne sans inventer une donnée.

## MQTT et ESPHome

MQTT n’est volontairement pas requis dans `0.1.2`. HTTP est suffisant pour quelques sondes envoyant une mesure par minute et évite Mosquitto, ACL et un second protocole temps réel.

Ajoutez MQTT lorsque vous aurez beaucoup de capteurs ou besoin de commandes bidirectionnelles : Mosquitto local, TLS ou VLAN, identifiants par appareil, topics `homedash/sensors/{id}/state`, adaptateur backend transformant le message vers le même modèle `Sensor`. L’UI et la base ne doivent pas connaître la source.

ESPHome peut appeler l’endpoint via son composant `http_request` ou, plus tard, publier le même JSON sur MQTT. Home Assistant reste optionnel.
