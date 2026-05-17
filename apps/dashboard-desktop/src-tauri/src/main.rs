// Prevents an additional console window from showing up on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    homey_toolbox_dashboard_lib::run()
}
