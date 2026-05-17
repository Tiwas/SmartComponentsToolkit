import type { Language } from "@homey-toolbox/dashboard-shared";

/**
 * Every user-visible string in the dashboard. Keep keys stable; if you change
 * a key, update every call site. Placeholders use {name} interpolation.
 */
export interface Strings {
  // Screens
  loading: string;
  // Setup
  setup_title: string;
  setup_intro: string;
  setup_client_id: string;
  setup_client_secret: string;
  setup_save: string;
  // Login
  login_title: string;
  login_hint: string;
  login_button: string;
  login_waiting: string;
  // Titlebar
  tb_close: string;
  // Tabs
  tab_favorites: string;
  tab_flows: string;
  tab_refresh: string;
  tab_settings: string;
  // Dashboard
  search_placeholder: string;
  fav_new_folder: string;
  fav_quick_label: string;
  fav_empty: string;
  fav_empty_folder: string; // uses {name}
  fav_folder_empty_marker: string;
  no_flows: string;
  rename_btn: string;
  delete_btn: string;
  // Context menu — flow
  ctx_run: string;
  ctx_favorites_header: string;
  ctx_add_to_quick: string;
  ctx_move_to_quick: string;
  ctx_move_to: string; // uses {name}
  ctx_new_folder: string;
  ctx_remove_favorite: string;
  ctx_edit_in_browser: string;
  // Context menu — folder
  ctx_rename_folder: string;
  ctx_delete_folder: string;
  // FlowRow tooltips
  fr_remove_fav: string;
  fr_add_fav: string;
  // Prompt modal
  modal_cancel: string;
  modal_new_folder_title: string;
  modal_new_folder_placeholder: string;
  modal_new_folder_confirm: string;
  modal_rename_folder_title: string;
  modal_rename_folder_confirm: string;
  // Settings
  settings_title: string;
  settings_back: string;
  settings_autostart: string;
  settings_autostart_hint: string;
  settings_autostart_dev_disabled: string;
  settings_notifications: string;
  settings_show_toasts: string;
  settings_show_source: string;
  settings_toast_duration: string;
  settings_poll_interval: string;
  settings_test_toast: string;
  settings_test_toast_text: string;
  settings_account: string;
  settings_sign_out: string;
  settings_reset_creds: string;
  settings_mode: string;
  settings_mode_widget: string;
  settings_mode_dashboard: string;
  settings_mode_hint: string;
  settings_window: string;
  settings_hotkey: string;
  settings_hotkey_hint: string;
  settings_hotzone: string;
  settings_hotzone_hint: string;
  settings_hotzone_off: string;
  settings_hotzone_left: string;
  settings_hotzone_right: string;
  settings_hotzone_top: string;
  settings_hotzone_bottom: string;
  settings_hotzone_autohide: string;
  settings_hotzone_autohide_hint: string;
  settings_start_minimized: string;
  settings_start_minimized_hint: string;
  settings_homey: string;
  settings_homey_loading: string;
  settings_about: string;
  settings_homey_store: string;
  settings_docs: string;
  settings_github: string;
  settings_language: string;
  // Misc
  fallback_notification: string;
  fallback_device: string;
  // Floorplan
  floorplan_title: string;
  floorplan_empty_title: string;
  floorplan_empty_hint: string;
  floorplan_import: string;
  floorplan_import_file: string;
  floorplan_import_paste: string;
  floorplan_import_apply: string;
  floorplan_open_editor: string;
  floorplan_no_svg_yet: string;
}

const en: Strings = {
  loading: "Loading…",
  setup_title: "Connect your Homey",
  setup_intro:
    "Create an OAuth application at developer.athom.com and paste the credentials here. Add this redirect URL to your app:",
  setup_client_id: "Client ID",
  setup_client_secret: "Client Secret",
  setup_save: "Save",
  login_title: "Sign in to Homey",
  login_hint: "The system browser will open Athom’s OAuth page.",
  login_button: "Sign in",
  login_waiting: "Waiting for browser…",
  tb_close: "Close",
  tab_favorites: "★ Favorites",
  tab_flows: "Flows",
  tab_refresh: "Refresh flows",
  tab_settings: "Settings",
  search_placeholder: "Search flows…",
  fav_new_folder: "+ Folder",
  fav_quick_label: "★ Quick",
  fav_empty:
    "No favorites yet. Right-click any flow → Add to ★ Quick, or create folders to organize them. (Homey’s API doesn’t expose mobile-app favorites, so this list is dashboard-local.)",
  fav_empty_folder: "(drag flows here via right-click → Move to {name})",
  fav_folder_empty_marker: "(empty)",
  no_flows: "No flows.",
  rename_btn: "Rename",
  delete_btn: "Delete",
  ctx_run: "Run flow",
  ctx_favorites_header: "Favorites",
  ctx_add_to_quick: "Add to ★ Quick",
  ctx_move_to_quick: "Move to ★ Quick",
  ctx_move_to: "Move to {name}",
  ctx_new_folder: "+ New folder…",
  ctx_remove_favorite: "Remove from favorites",
  ctx_edit_in_browser: "Edit in browser…",
  ctx_rename_folder: "Rename folder",
  ctx_delete_folder: "Delete folder",
  fr_remove_fav: "Remove from favorites",
  fr_add_fav: "Add to favorites",
  modal_cancel: "Cancel",
  modal_new_folder_title: "New folder",
  modal_new_folder_placeholder: "Folder name",
  modal_new_folder_confirm: "Create",
  modal_rename_folder_title: "Rename folder",
  modal_rename_folder_confirm: "Rename",
  settings_title: "Settings",
  settings_back: "Back",
  settings_autostart: "Start with system",
  settings_autostart_hint:
    "When enabled, the widget launches automatically when you sign in to your computer.",
  settings_autostart_dev_disabled:
    "Disabled in development mode — the autostart link would point at the dev build, which opens a console window and breaks once you build a release. Enable this only after installing the release build.",
  settings_notifications: "Notifications",
  settings_show_toasts: "Show toasts",
  settings_show_source: "Show source (“Flow — …”)",
  settings_toast_duration: "Toast duration (seconds)",
  settings_poll_interval: "Poll interval (seconds)",
  settings_test_toast: "Send test toast",
  settings_test_toast_text: "Test toast — this is what notifications will look like",
  settings_account: "Account",
  settings_sign_out: "Sign out (keep credentials)",
  settings_reset_creds: "Reset OAuth credentials",
  settings_mode: "App mode",
  settings_mode_widget: "Widget (floating)",
  settings_mode_dashboard: "Dashboard (full window)",
  settings_mode_hint:
    "Widget is a small always-on-top tooltip beside your editor. Dashboard mode resizes to a normal window for a floorplan overview.",
  settings_window: "Window",
  settings_hotkey: "Show/hide shortcut",
  settings_hotkey_hint:
    "Global shortcut to toggle the widget. Use Tauri accelerator format, e.g. CommandOrControl+Shift+H. Leave empty to disable.",
  settings_hotzone: "Hotzone (cursor edge trigger)",
  settings_hotzone_hint:
    "Move the cursor all the way against the chosen screen edge to pop the widget out. Disabled by default.",
  settings_hotzone_off: "Off",
  settings_hotzone_left: "Left edge",
  settings_hotzone_right: "Right edge",
  settings_hotzone_top: "Top edge",
  settings_hotzone_bottom: "Bottom edge",
  settings_hotzone_autohide: "Auto-hide after (seconds)",
  settings_hotzone_autohide_hint:
    "If you don't move the cursor onto the widget, it hides itself again after this many seconds.",
  settings_start_minimized: "Start minimized",
  settings_start_minimized_hint:
    "When enabled, the widget launches hidden. Bring it up with the tray icon, the global shortcut or the hotzone.",
  settings_homey: "Active Homey",
  settings_homey_loading: "Loading…",
  settings_about: "About",
  settings_homey_store: "Homey App Store →",
  settings_docs: "Documentation →",
  settings_github: "GitHub repository →",
  settings_language: "Language",
  fallback_notification: "Notification",
  fallback_device: "Device",
  floorplan_title: "Floorplan",
  floorplan_empty_title: "No floorplan yet",
  floorplan_empty_hint:
    "Import an SVG you've drawn (any tool that exports SVG works) and devices for each Homey zone will appear inside their rooms.",
  floorplan_import: "Import floorplan",
  floorplan_import_file: "Open file",
  floorplan_import_paste: "Paste SVG",
  floorplan_import_apply: "Import",
  floorplan_open_editor: "Open the floorplan editor",
  floorplan_no_svg_yet: "Don't have an SVG yet?",
};

const no: Strings = {
  loading: "Laster…",
  setup_title: "Koble til din Homey",
  setup_intro:
    "Opprett en OAuth-applikasjon på developer.athom.com og lim inn legitimasjonen her. Legg til denne redirect-URL-en i appen din:",
  setup_client_id: "Client ID",
  setup_client_secret: "Client Secret",
  setup_save: "Lagre",
  login_title: "Logg inn på Homey",
  login_hint: "Systembrowseren åpner Athoms OAuth-side.",
  login_button: "Logg inn",
  login_waiting: "Venter på nettleser…",
  tb_close: "Lukk",
  tab_favorites: "★ Favoritter",
  tab_flows: "Flows",
  tab_refresh: "Oppdater flows",
  tab_settings: "Innstillinger",
  search_placeholder: "Søk i flows…",
  fav_new_folder: "+ Mappe",
  fav_quick_label: "★ Hurtig",
  fav_empty:
    "Ingen favoritter ennå. Høyreklikk på en flow → Legg til i ★ Hurtig, eller lag mapper for å organisere dem. (Homey-API-et eksponerer ikke favoritter fra mobil-appen, så denne listen er lokal til widget-en.)",
  fav_empty_folder: "(dra flows hit via høyreklikk → Flytt til {name})",
  fav_folder_empty_marker: "(tom)",
  no_flows: "Ingen flows.",
  rename_btn: "Gi nytt navn",
  delete_btn: "Slett",
  ctx_run: "Kjør flow",
  ctx_favorites_header: "Favoritter",
  ctx_add_to_quick: "Legg til i ★ Hurtig",
  ctx_move_to_quick: "Flytt til ★ Hurtig",
  ctx_move_to: "Flytt til {name}",
  ctx_new_folder: "+ Ny mappe…",
  ctx_remove_favorite: "Fjern fra favoritter",
  ctx_edit_in_browser: "Rediger i nettleseren…",
  ctx_rename_folder: "Gi mappen nytt navn",
  ctx_delete_folder: "Slett mappe",
  fr_remove_fav: "Fjern fra favoritter",
  fr_add_fav: "Legg til i favoritter",
  modal_cancel: "Avbryt",
  modal_new_folder_title: "Ny mappe",
  modal_new_folder_placeholder: "Mappenavn",
  modal_new_folder_confirm: "Opprett",
  modal_rename_folder_title: "Gi mappen nytt navn",
  modal_rename_folder_confirm: "Endre navn",
  settings_title: "Innstillinger",
  settings_back: "Tilbake",
  settings_autostart: "Start med systemet",
  settings_autostart_hint:
    "Når aktivert, starter widget-en automatisk når du logger inn på datamaskinen.",
  settings_autostart_dev_disabled:
    "Deaktivert i utviklingsmodus — autostart-lenken ville pekt på dev-bygget, som åpner et konsollvindu og slutter å fungere når du bygger en release. Aktiver dette først etter at du har installert release-bygget.",
  settings_notifications: "Varsler",
  settings_show_toasts: "Vis toasts",
  settings_show_source: "Vis kilde («Flow — …»)",
  settings_toast_duration: "Visningstid (sekunder)",
  settings_poll_interval: "Sjekkintervall (sekunder)",
  settings_test_toast: "Send test-toast",
  settings_test_toast_text: "Test-toast — slik vil varsler se ut",
  settings_account: "Konto",
  settings_sign_out: "Logg ut (behold legitimasjon)",
  settings_reset_creds: "Nullstill OAuth-legitimasjon",
  settings_mode: "App-modus",
  settings_mode_widget: "Widget (flytende)",
  settings_mode_dashboard: "Dashboard (helt vindu)",
  settings_mode_hint:
    "Widget er en liten alltid-på-topp ved siden av editoren. Dashboard-modus utvider til et normalt vindu med oversiktskart.",
  settings_window: "Vindu",
  settings_hotkey: "Hurtigtast for vis/skjul",
  settings_hotkey_hint:
    "Global hurtigtast for å veksle widget-en. Bruk Tauri-format, f.eks. CommandOrControl+Shift+H. Tom = deaktivert.",
  settings_hotzone: "Hotzone (musepeker mot skjermkant)",
  settings_hotzone_hint:
    "Beveg musen helt mot valgt skjermkant for å hente fram widget-en. Av som standard.",
  settings_hotzone_off: "Av",
  settings_hotzone_left: "Venstre kant",
  settings_hotzone_right: "Høyre kant",
  settings_hotzone_top: "Topp",
  settings_hotzone_bottom: "Bunn",
  settings_hotzone_autohide: "Skjul igjen etter (sekunder)",
  settings_hotzone_autohide_hint:
    "Hvis du ikke beveger musen inn på widget-en, skjuler den seg selv etter så mange sekunder.",
  settings_start_minimized: "Start minimert",
  settings_start_minimized_hint:
    "Når aktivert, starter widget-en skjult. Hent den fram med tray-ikonet, hurtigtasten eller hotzonen.",
  settings_homey: "Aktiv Homey",
  settings_homey_loading: "Laster…",
  settings_about: "Om",
  settings_homey_store: "Homey App Store →",
  settings_docs: "Dokumentasjon →",
  settings_github: "GitHub-repo →",
  settings_language: "Språk",
  fallback_notification: "Varsel",
  fallback_device: "Enhet",
  floorplan_title: "Plantegning",
  floorplan_empty_title: "Ingen plantegning ennå",
  floorplan_empty_hint:
    "Importer en SVG du har tegnet (alle verktøy som eksporterer SVG funker) — enheter i hver Homey-zone vises automatisk i sine rom.",
  floorplan_import: "Importer plantegning",
  floorplan_import_file: "Åpne fil",
  floorplan_import_paste: "Lim inn SVG",
  floorplan_import_apply: "Importer",
  floorplan_open_editor: "Åpne plantegnings-editoren",
  floorplan_no_svg_yet: "Har du ikke en SVG ennå?",
};

const de: Strings = {
  loading: "Lädt…",
  setup_title: "Verbinde deine Homey",
  setup_intro:
    "Erstelle eine OAuth-Anwendung unter developer.athom.com und füge die Zugangsdaten hier ein. Trage diese Weiterleitungs-URL in deiner App ein:",
  setup_client_id: "Client ID",
  setup_client_secret: "Client Secret",
  setup_save: "Speichern",
  login_title: "Bei Homey anmelden",
  login_hint: "Der Systembrowser öffnet die OAuth-Seite von Athom.",
  login_button: "Anmelden",
  login_waiting: "Warte auf den Browser…",
  tb_close: "Schließen",
  tab_favorites: "★ Favoriten",
  tab_flows: "Flows",
  tab_refresh: "Flows aktualisieren",
  tab_settings: "Einstellungen",
  search_placeholder: "Flows durchsuchen…",
  fav_new_folder: "+ Ordner",
  fav_quick_label: "★ Schnell",
  fav_empty:
    "Noch keine Favoriten. Rechtsklick auf einen Flow → Zu ★ Schnell hinzufügen, oder erstelle Ordner, um sie zu organisieren. (Die Homey-API gibt mobile App-Favoriten nicht aus, daher ist diese Liste lokal im Widget.)",
  fav_empty_folder: "(per Rechtsklick → Verschieben nach {name} hierhin ziehen)",
  fav_folder_empty_marker: "(leer)",
  no_flows: "Keine Flows.",
  rename_btn: "Umbenennen",
  delete_btn: "Löschen",
  ctx_run: "Flow ausführen",
  ctx_favorites_header: "Favoriten",
  ctx_add_to_quick: "Zu ★ Schnell hinzufügen",
  ctx_move_to_quick: "Nach ★ Schnell verschieben",
  ctx_move_to: "Verschieben nach {name}",
  ctx_new_folder: "+ Neuer Ordner…",
  ctx_remove_favorite: "Aus Favoriten entfernen",
  ctx_edit_in_browser: "Im Browser bearbeiten…",
  ctx_rename_folder: "Ordner umbenennen",
  ctx_delete_folder: "Ordner löschen",
  fr_remove_fav: "Aus Favoriten entfernen",
  fr_add_fav: "Zu Favoriten hinzufügen",
  modal_cancel: "Abbrechen",
  modal_new_folder_title: "Neuer Ordner",
  modal_new_folder_placeholder: "Ordnername",
  modal_new_folder_confirm: "Erstellen",
  modal_rename_folder_title: "Ordner umbenennen",
  modal_rename_folder_confirm: "Umbenennen",
  settings_title: "Einstellungen",
  settings_back: "Zurück",
  settings_autostart: "Mit System starten",
  settings_autostart_hint:
    "Wenn aktiviert, startet das Widget automatisch, wenn du dich bei deinem Computer anmeldest.",
  settings_autostart_dev_disabled:
    "Im Entwicklungsmodus deaktiviert — der Autostart-Eintrag würde auf das Dev-Build zeigen, das ein Konsolenfenster öffnet und nach einem Release-Build nicht mehr funktioniert. Aktiviere dies erst nach Installation des Release-Builds.",
  settings_notifications: "Benachrichtigungen",
  settings_show_toasts: "Toasts anzeigen",
  settings_show_source: "Quelle anzeigen („Flow — …“)",
  settings_toast_duration: "Anzeigedauer (Sekunden)",
  settings_poll_interval: "Abfrageintervall (Sekunden)",
  settings_test_toast: "Test-Toast senden",
  settings_test_toast_text: "Test-Toast — so sehen Benachrichtigungen aus",
  settings_account: "Konto",
  settings_sign_out: "Abmelden (Zugangsdaten behalten)",
  settings_reset_creds: "OAuth-Zugangsdaten zurücksetzen",
  settings_mode: "App-Modus",
  settings_mode_widget: "Widget (schwebend)",
  settings_mode_dashboard: "Dashboard (volles Fenster)",
  settings_mode_hint:
    "Widget ist ein kleines Always-on-Top-Fenster neben dem Editor. Im Dashboard-Modus wird es zu einem normalen Fenster mit Grundriss-Übersicht.",
  settings_window: "Fenster",
  settings_hotkey: "Tastenkürzel zum Ein-/Ausblenden",
  settings_hotkey_hint:
    "Globales Tastenkürzel zum Umschalten des Widgets. Verwende Tauri-Format, z. B. CommandOrControl+Shift+H. Leer = deaktiviert.",
  settings_hotzone: "Hotzone (Mauszeiger an Bildschirmrand)",
  settings_hotzone_hint:
    "Bewege den Mauszeiger ganz an den gewählten Bildschirmrand, um das Widget einzublenden. Standardmäßig aus.",
  settings_hotzone_off: "Aus",
  settings_hotzone_left: "Linker Rand",
  settings_hotzone_right: "Rechter Rand",
  settings_hotzone_top: "Oberer Rand",
  settings_hotzone_bottom: "Unterer Rand",
  settings_hotzone_autohide: "Wieder ausblenden nach (Sekunden)",
  settings_hotzone_autohide_hint:
    "Wenn der Cursor das Widget nicht erreicht, blendet es sich nach dieser Zeit selbst aus.",
  settings_start_minimized: "Minimiert starten",
  settings_start_minimized_hint:
    "Wenn aktiviert, startet das Widget ausgeblendet. Hol es per Tray-Symbol, Tastenkürzel oder Hotzone hervor.",
  settings_homey: "Aktive Homey",
  settings_homey_loading: "Lädt…",
  settings_about: "Über",
  settings_homey_store: "Homey App Store →",
  settings_docs: "Dokumentation →",
  settings_github: "GitHub-Repository →",
  settings_language: "Sprache",
  fallback_notification: "Benachrichtigung",
  fallback_device: "Gerät",
  floorplan_title: "Grundriss",
  floorplan_empty_title: "Noch kein Grundriss",
  floorplan_empty_hint:
    "Importiere ein SVG, das du gezeichnet hast (jedes Tool, das SVG exportiert, funktioniert) — Geräte jeder Homey-Zone erscheinen automatisch in ihren Räumen.",
  floorplan_import: "Grundriss importieren",
  floorplan_import_file: "Datei öffnen",
  floorplan_import_paste: "SVG einfügen",
  floorplan_import_apply: "Importieren",
  floorplan_open_editor: "Grundriss-Editor öffnen",
  floorplan_no_svg_yet: "Hast du noch kein SVG?",
};

const nl: Strings = {
  loading: "Laden…",
  setup_title: "Verbind je Homey",
  setup_intro:
    "Maak een OAuth-applicatie aan op developer.athom.com en plak hier de gegevens. Voeg deze redirect-URL toe aan je app:",
  setup_client_id: "Client ID",
  setup_client_secret: "Client Secret",
  setup_save: "Opslaan",
  login_title: "Inloggen bij Homey",
  login_hint: "De systeembrowser opent Athom’s OAuth-pagina.",
  login_button: "Inloggen",
  login_waiting: "Wachten op browser…",
  tb_close: "Sluiten",
  tab_favorites: "★ Favorieten",
  tab_flows: "Flows",
  tab_refresh: "Flows verversen",
  tab_settings: "Instellingen",
  search_placeholder: "Zoek in flows…",
  fav_new_folder: "+ Map",
  fav_quick_label: "★ Snel",
  fav_empty:
    "Nog geen favorieten. Klik met rechts op een flow → Toevoegen aan ★ Snel, of maak mappen om ze te organiseren. (De Homey-API stelt favorieten uit de mobiele app niet beschikbaar, dus deze lijst staat lokaal in de widget.)",
  fav_empty_folder: "(sleep flows hierheen via rechtsklik → Verplaatsen naar {name})",
  fav_folder_empty_marker: "(leeg)",
  no_flows: "Geen flows.",
  rename_btn: "Hernoemen",
  delete_btn: "Verwijderen",
  ctx_run: "Flow uitvoeren",
  ctx_favorites_header: "Favorieten",
  ctx_add_to_quick: "Toevoegen aan ★ Snel",
  ctx_move_to_quick: "Verplaatsen naar ★ Snel",
  ctx_move_to: "Verplaatsen naar {name}",
  ctx_new_folder: "+ Nieuwe map…",
  ctx_remove_favorite: "Verwijderen uit favorieten",
  ctx_edit_in_browser: "Bewerken in browser…",
  ctx_rename_folder: "Map hernoemen",
  ctx_delete_folder: "Map verwijderen",
  fr_remove_fav: "Verwijderen uit favorieten",
  fr_add_fav: "Toevoegen aan favorieten",
  modal_cancel: "Annuleren",
  modal_new_folder_title: "Nieuwe map",
  modal_new_folder_placeholder: "Mapnaam",
  modal_new_folder_confirm: "Aanmaken",
  modal_rename_folder_title: "Map hernoemen",
  modal_rename_folder_confirm: "Hernoemen",
  settings_title: "Instellingen",
  settings_back: "Terug",
  settings_autostart: "Starten met systeem",
  settings_autostart_hint:
    "Indien ingeschakeld start de widget automatisch bij het aanmelden op je computer.",
  settings_autostart_dev_disabled:
    "Uitgeschakeld in ontwikkelingsmodus — de autostart-link zou naar de dev-build wijzen, die een consolevenster opent en kapotgaat zodra je een release bouwt. Schakel dit pas in nadat je de release-build hebt geïnstalleerd.",
  settings_notifications: "Meldingen",
  settings_show_toasts: "Toasts tonen",
  settings_show_source: "Bron tonen (“Flow — …”)",
  settings_toast_duration: "Toast-duur (seconden)",
  settings_poll_interval: "Poll-interval (seconden)",
  settings_test_toast: "Test-toast verzenden",
  settings_test_toast_text: "Test-toast — zo zien meldingen eruit",
  settings_account: "Account",
  settings_sign_out: "Uitloggen (gegevens bewaren)",
  settings_reset_creds: "OAuth-gegevens resetten",
  settings_mode: "App-modus",
  settings_mode_widget: "Widget (zwevend)",
  settings_mode_dashboard: "Dashboard (volledig venster)",
  settings_mode_hint:
    "Widget is een kleine altijd-bovenop tooltip naast je editor. Dashboard-modus vergroot tot een normaal venster met plattegrond-overzicht.",
  settings_window: "Venster",
  settings_hotkey: "Sneltoets voor tonen/verbergen",
  settings_hotkey_hint:
    "Globale sneltoets om de widget te wisselen. Gebruik Tauri-formaat, bv. CommandOrControl+Shift+H. Leeg = uitgeschakeld.",
  settings_hotzone: "Hotzone (cursor naar schermrand)",
  settings_hotzone_hint:
    "Beweeg de cursor helemaal tegen de gekozen schermrand om de widget tevoorschijn te halen. Standaard uit.",
  settings_hotzone_off: "Uit",
  settings_hotzone_left: "Linker rand",
  settings_hotzone_right: "Rechter rand",
  settings_hotzone_top: "Bovenrand",
  settings_hotzone_bottom: "Onderrand",
  settings_hotzone_autohide: "Opnieuw verbergen na (seconden)",
  settings_hotzone_autohide_hint:
    "Als de cursor de widget niet bereikt, verbergt deze zichzelf na deze tijd weer.",
  settings_start_minimized: "Geminimaliseerd starten",
  settings_start_minimized_hint:
    "Indien ingeschakeld start de widget verborgen. Haal hem op via het systray-icoon, de sneltoets of de hotzone.",
  settings_homey: "Actieve Homey",
  settings_homey_loading: "Laden…",
  settings_about: "Over",
  settings_homey_store: "Homey App Store →",
  settings_docs: "Documentatie →",
  settings_github: "GitHub-repository →",
  settings_language: "Taal",
  fallback_notification: "Melding",
  fallback_device: "Apparaat",
  floorplan_title: "Plattegrond",
  floorplan_empty_title: "Nog geen plattegrond",
  floorplan_empty_hint:
    "Importeer een SVG die je hebt getekend (elk tool dat SVG exporteert werkt) — apparaten van elke Homey-zone verschijnen automatisch in hun kamer.",
  floorplan_import: "Plattegrond importeren",
  floorplan_import_file: "Bestand openen",
  floorplan_import_paste: "SVG plakken",
  floorplan_import_apply: "Importeren",
  floorplan_open_editor: "Open de plattegrond-editor",
  floorplan_no_svg_yet: "Heb je nog geen SVG?",
};

export const STRINGS: Record<Language, Strings> = { en, no, de, nl };

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  no: "Norsk",
  de: "Deutsch",
  nl: "Nederlands",
};

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}
