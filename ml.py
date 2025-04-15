import tkinter as tk
from tkinter import ttk, messagebox
import psutil
import json
import os
import speech_recognition as sr  
import pyttsx3                 
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import time

engine = pyttsx3.init()
engine.setProperty('rate', 150)
def speak(text):
    engine.say(text)
    engine.runAndWait()

# === Feedback DB ===
FEEDBACK_FILE = "feedback.json"

def load_feedback():
    if os.path.exists(FEEDBACK_FILE):
        with open(FEEDBACK_FILE, "r") as f:
            return json.load(f)
    return {}

def save_feedback():
    with open(FEEDBACK_FILE, "w") as f:
        json.dump(feedback, f, indent=4)

feedback = load_feedback()

# === Process Monitoring ===
def get_processes():
    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
        try:
            info = proc.info
            processes.append(info)
        except psutil.NoSuchProcess:
            pass
    return processes

def refresh_processes():
    # Clear the tree view
    for row in tree.get_children():
        tree.delete(row)

    processes = get_processes()
    grouped = {}
    for proc in processes:
        name = proc['name']
        if name not in grouped:
            grouped[name] = {
                'pids': [],
                'cpu': 0.0,
                'memory': 0.0,
                'count': 0
            }
        grouped[name]['pids'].append(proc['pid'])
        grouped[name]['cpu'] += proc['cpu_percent']
        grouped[name]['memory'] += proc['memory_percent']
        grouped[name]['count'] += 1

    for name, info in grouped.items():
        status = ""
        if info['cpu'] > 50:
            status = "High CPU"
        elif info['memory'] > 50:
            status = "High Memory"

        tree.insert("", "end", values=(
            ", ".join(map(str, info['pids'])),
            f"{name} (x{info['count']})",
            f"{info['cpu']}%",
            f"{round(info['memory'], 2)}%",
            status
        ))
    set_status("Process list refreshed and grouped.")

def lower_priority():
    selected = tree.selection()
    if not selected:
        messagebox.showinfo("Info", "Please select a process group first.")
        return

    pids = tree.item(selected[0])['values'][0].split(", ")
    name = tree.item(selected[0])['values'][1]
    confirm = messagebox.askyesno("Suggestion", f"Process group '{name}' is consuming high resources.\nLower priority for the first instance?")
    
    if confirm:
        try:
            pid = int(pids[0])
            proc = psutil.Process(pid)
            proc.nice(10)
            feedback[str(pid)] = "lowered"
            save_feedback()
            set_status(f"Priority of '{name}' lowered.")
            speak(f"Priority of {name} lowered.")
            refresh_processes()
        except Exception as e:
            messagebox.showerror("Error", str(e))
            set_status(f"Error: {e}")

def run_command(cmd=None):
    if cmd is None:
        cmd = command_entry.get().lower().strip()
    else:
        command_entry.delete(0, tk.END)
        command_entry.insert(0, cmd)
    
    if not cmd:
        set_status("Please enter a command.")
        return

    response = ""
    
    if "open" in cmd:
        app = cmd.replace("open", "").strip()
        os.system(f"start {app}")
        response = f"Opening {app}"
    
    elif "search" in cmd:
        response = "Search functionality coming soon!"
        messagebox.showinfo("Search", response)
    
    elif "kill" in cmd or "close" in cmd:
        app = cmd.replace("kill", "").replace("close", "").strip()
        if not app:
            response = "Please specify a process to kill."
        else:
            matched_processes = []
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    if app.lower() in proc.info['name'].lower():
                        matched_processes.append(proc)
                except psutil.NoSuchProcess:
                    continue

            if matched_processes:
                confirm = messagebox.askyesno("Confirm Kill", f"Are you sure you want to close '{app}'?")
                if confirm:
                    for proc in matched_processes:
                        try:
                            proc.terminate()
                            response = f"Killed {proc.info['name']} (PID: {proc.info['pid']})"
                        except psutil.NoSuchProcess:
                            continue
            else:
                response = f"No process found matching '{app}'."
        messagebox.showinfo("Kill Command", response)
    
    else:
        response = "Unknown command. Try 'open', 'search', or 'kill'."
        messagebox.showinfo("Unknown Command", response)
    
    set_status(response)
    speak(response)

def start_listening():
    recording_var.set("Recording...")
    set_status("Listening...")
    root.update_idletasks()  # Force UI update
    r = sr.Recognizer()
    with sr.Microphone() as source:
        try:
            # Adjust for ambient noise
            r.adjust_for_ambient_noise(source, duration=1)
            print("Adjusted for ambient noise. Listening now...")
            audio = r.listen(source, timeout=5)
            print("Audio captured, processing...")
            command = r.recognize_google(audio)
            print(f"Recognized command: {command}")
            set_status(f"You said: {command}")
            speak(f"You said: {command}")
            run_command(command.lower().strip())
        except sr.UnknownValueError:
            set_status("Could not understand audio.")
            speak("I could not understand what you said.")
            print("Speech recognition could not understand audio.")
        except sr.RequestError as e:
            set_status(f"Speech recognition error: {e}")
            speak("There was an error with the speech recognition service.")
            print(f"Request error: {e}")
        except sr.WaitTimeoutError:
            set_status("Listening timed out. Please try again.")
            speak("Listening timed out. Please try again.")
            print("Listening timed out.")
        except Exception as e:
            set_status(f"Error: {e}")
            speak("An error occurred during listening.")
            print(f"Unexpected error: {e}")
        finally:
            recording_var.set("Not Recording")
            root.update_idletasks()  # Force UI update

def set_status(msg):
    status_var.set(msg)

# === System Monitoring Graphs ===
cpu_history = []
mem_history = []
time_history = []

def update_graphs():
    cpu_percent = psutil.cpu_percent()
    mem_percent = psutil.virtual_memory().percent
    current_time = time.time()

    cpu_history.append(cpu_percent)
    mem_history.append(mem_percent)
    time_history.append(current_time)

    # Keep only the last 60 data points
    if len(cpu_history) > 60:
        cpu_history.pop(0)
        mem_history.pop(0)
        time_history.pop(0)

    cpu_ax.clear()
    mem_ax.clear()

    cpu_ax.plot(time_history, cpu_history, 'b-')
    cpu_ax.set_title('CPU Usage')
    cpu_ax.set_ylim(0, 100)
    cpu_ax.set_ylabel('Usage (%)')
    cpu_ax.set_xlabel('Time (s)')

    mem_ax.plot(time_history, mem_history, 'r-')
    mem_ax.set_title('Memory Usage')
    mem_ax.set_ylim(0, 100)
    mem_ax.set_ylabel('Usage (%)')
    mem_ax.set_xlabel('Time (s)')

    if time_history:
        start_time = time_history[0]
        ticks = [start_time + i*10 for i in range(int((time_history[-1]-start_time)/10)+1)]
        labels = [f"{i:.1f}s" for i in range(0, int((time_history[-1]-start_time)//10)*10+1, 10)]
        cpu_ax.set_xticks(ticks)
        cpu_ax.set_xticklabels(labels)
        mem_ax.set_xticks(cpu_ax.get_xticks())
        mem_ax.set_xticklabels(cpu_ax.get_xticklabels())

    canvas.draw()
    root.after(1000, update_graphs)

root = tk.Tk()
root.title("AI-Enhanced Smart Task Manager")
root.geometry("900x700")

# Create main frame
main_frame = ttk.Frame(root)
main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

# Create dashboard frame for graphs
dashboard_frame = ttk.LabelFrame(main_frame, text="System Dashboard", padding=10)
dashboard_frame.pack(fill=tk.BOTH, expand=False, padx=10, pady=10)

# Create figure and subplots
fig = plt.Figure(figsize=(9, 3), dpi=100)
cpu_ax = fig.add_subplot(121)
mem_ax = fig.add_subplot(122)

# Create canvas to display the figure
canvas = FigureCanvasTkAgg(fig, master=dashboard_frame)
canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

# Process Manager Section
process_manager_frame = ttk.LabelFrame(main_frame, text="Process Manager", padding=10)
process_manager_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

tree_frame = ttk.Frame(process_manager_frame)
tree_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

tree = ttk.Treeview(tree_frame, columns=('PIDs', 'Name', 'CPU %', 'Memory %', 'Status'),
                    show='headings')
for col in ('PIDs', 'Name', 'CPU %', 'Memory %', 'Status'):
    tree.heading(col, text=col)
    tree.column(col, anchor=tk.CENTER, width=140)
tree.pack(fill=tk.BOTH, expand=True)

btn_frame = ttk.Frame(process_manager_frame)
btn_frame.pack(pady=5)
ttk.Button(btn_frame, text="Refresh", command=refresh_processes).pack(side=tk.LEFT, padx=10)
ttk.Button(btn_frame, text="Lower Priority", command=lower_priority).pack(side=tk.LEFT, padx=10)

# Virtual Assistant Section
va_frame = ttk.LabelFrame(main_frame, text="Virtual Assistant", padding=10)
va_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

ttk.Label(va_frame, text="Enter command (e.g., 'open chrome', 'kill notepad'):", font=("Arial", 12)).pack(pady=5)
command_entry = ttk.Entry(va_frame, width=60, font=("Arial", 12))
command_entry.pack(pady=5)

# Recording Status Indicator
recording_var = tk.StringVar(value="Not Recording")
recording_label = ttk.Label(va_frame, textvariable=recording_var, font=("Arial", 10), foreground="red")
recording_label.pack(pady=5)

va_btn_frame = ttk.Frame(va_frame)
va_btn_frame.pack(pady=5)
ttk.Button(va_btn_frame, text="Run", command=lambda: run_command()).pack(side=tk.LEFT, padx=10)
ttk.Button(va_btn_frame, text="Listen", command=start_listening).pack(side=tk.LEFT, padx=10)

# Status Bar
status_var = tk.StringVar()
status_var.set("Ready")
status_bar = ttk.Label(root, textvariable=status_var, relief=tk.SUNKEN, anchor=tk.W, padding=5, font=("Arial", 10))
status_bar.pack(side=tk.BOTTOM, fill=tk.X)

# Pre-initialize CPU usage readings
psutil.cpu_percent(interval=0.1)
for proc in psutil.process_iter():
    try:
        proc.cpu_percent(interval=None)
    except Exception:
        pass

# Start live updates
def live_update():
    refresh_processes()
    update_graphs()
    root.after(1000, live_update)

live_update()

root.mainloop()