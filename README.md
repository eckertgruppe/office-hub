# Office Hub

Zentrales Hub für Tickets & Termine für kleine Teams (5+ Mitarbeiter).

## Features (Phase 1 – aktuell)

- ✅ Tickets & Termine erstellen, zuweisen, bearbeiten
- ✅ Status: offen / in Arbeit / erledigt (mit ein-Klick-Abhaken)
- ✅ Priorität, Fälligkeit, Zuständige Person
- ✅ Mitarbeiterverwaltung (Name, Outlook-E-Mail, WhatsApp-Nummer)
- ✅ Dashboard mit Statistiken
- ✅ Filter (Status, Typ, Person)
- ✅ Tägliche Erinnerungs-Job um 8:00 Uhr (Cron)
- ✅ Schickes, modernes UI (Gradient, responsive)

## Features (Phase 2 – geplant)

- 📱 WhatsApp-Versand der Erinnerungen (privater Account per QR)
- 📧 E-Mail-Versand via Outlook 365
- 📅 Termin-Sync in Outlook-Kalender
- 🔔 Push-Benachrichtigungen im Browser

## Setup

```powershell
cd office-hub/backend
npm install
copy .env.example .env
npm start
```

Dann im Browser: http://localhost:3000

## Cloud-Deployment

Empfehlung: **Railway**, **Fly.io** oder **Hetzner Cloud**

Benötigt Persistent Volume für `data/hub.db`.

## Technik

- Backend: Node.js + Express + better-sqlite3
- Frontend: Vanilla HTML/CSS/JS (kein Build nötig)
- DB: SQLite (Datei-basiert)
- Scheduler: node-cron
