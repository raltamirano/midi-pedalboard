class Pattern {
	constructor(name) {
		this.name = name;
		this.tempo = 0;
		this.groovesMode = 'sequence';
		this.fillsMode = 'sequence';
		this.grooves = [];
		this.fills = [];
	};	
	
	getLengthTicks(events) {
		var totalTicks = 0;
		for (var i=0; i<events.length; i++) {
			var event = events[i];
			if (event.type == 8 || event.type == 9 || (event.type == 255 && event.metaType == 47)) 
				totalTicks += event.deltaTime;
		}
		return totalTicks;
	}
	
	toTrack(data) {		
		var midi = MidiParser.parse(data);
		var midiTrack = midi.formatType == 0 ? midi.track[0] : midi.track[1];
		var ppqn = midi.timeDivision;
		
		var track = {
			"ppqn": ppqn,
			"events": JSON.parse(JSON.stringify(midiTrack.event)),
			"length": this.getLengthTicks(midiTrack.event)
		};
		
		return track;
	}

	createGroove(type, name, data) {
		this.grooves.push({
			"type": type,
			"name": name,
			"track": this.toTrack(data)
		});
	}

	createFill(type, name, data) {
		this.fills.push({
			"type": type,
			"name": name,
			"track": this.toTrack(data)
		});
	}	
}

class Song {
	constructor() {
		this.title = "Untitled";
		this.tempo = 120;
		this.patterns = {};
		this.actions = {}
	};
	
	createPattern() {
		var currentPatterns = Object.keys(this.patterns);
		for(var i=currentPatterns.length; i<100; i++) {
			var newPatternName = "Pattern " + (i+1);
			if (!(newPatternName in this.patterns)) {
				var newPattern = new Pattern(newPatternName);
				this.patterns[newPatternName] = newPattern; 
				return;
			}
		}
	}
	
	renamePattern(from, to) {
		if (!from || !to || from == to)
			return false;
		
		var pattern = this.patterns[from];
		if (!pattern)
			return false;
		
		pattern.name = to;
		delete this.patterns[from];
		this.patterns[to] = pattern;

		// TODO: Fix references in actions!
		
		return true;
	}
	
	deletePattern(name) {
		delete this.patterns[name];
		
		// TODO: Remove references in actions!
	}
}

class Orchestrator extends EventTarget {
	constructor(song) {
		super();
		
		this.song = song;
		this.tempo = song.tempo;
		this.playingPattern = null;
		this.playingWhat = null;
		this.currentGroove = null;
		this.nextPattern = null;
		this.groovesRepeats = {};
		this.fillsRepeats = {};
		
		this.firePlayStatusChanged = this.firePlayStatusChanged.bind(this);
		this.startPlayingPattern = this.startPlayingPattern.bind(this);
		this.playEvents = this.playEvents.bind(this);
		this.onAllEventsPlayed = this.onAllEventsPlayed.bind(this);
		this.checkCallAfter = this.checkCallAfter.bind(this);
		this.callAfter = this.callAfter.bind(this);
	}	

	checkCallAfter() {
		var elapsed = performance.now() - this.ca_requested;
		if (elapsed < this.ca_millis)
			return setTimeout(this.checkCallAfter, 0);

		console.log('checkCallAfter actually executed after: ' + elapsed + ' ms'); 
		
		var fn = this.ca_fn;
		var opts = this.ca_opts;
		
		delete this['ca_requested'];
		delete this['ca_fn'];
		delete this['ca_millis'];
		delete this['ca_opts'];

		fn(opts);
	}
	
	callAfter(callback, millis, opts) {
		this.ca_requested = performance.now();
		this.ca_fn = callback;
		this.ca_millis = millis;
		this.ca_opts = opts;
		return setTimeout(this.checkCallAfter, 0);
	}
		
	isPlaying() {
		return this.playingPattern != null;
	}

	firePlayStatusChanged() {
		this.dispatchEvent(new CustomEvent("playStatusChanged", { 
			"detail": { 
				"currentPattern": this.playingPattern,
				"nextPattern": this.nextPattern 
			} 
		}));		
	}
	
	playNext(patternName) {
		var pattern = this.song.patterns[patternName];
		if (!pattern || pattern.grooves.length == 0)
			return;			
		
		if(!this.playingPattern) {
			// No pattern is currently playing, so let's play the requested one.
			this.playingPattern = pattern.name;
			this.startPlayingPattern();
		} else {
			if (this.playingPattern == pattern.name) {
				// User requested to play the same pattern as the one currently playing.				
				// Clear next pattern, if any.
				this.nextPattern = null;
			} else {
				this.nextPattern = pattern.name;
			}
		}
		this.firePlayStatusChanged();
	}
			
	playEvents(track, startAt, justBefore, opts) {
		if (!activeMidiOut) {
			console.log('No active MIDI out port!');
			return;
		}

		var f = 60000 / this.tempo / track.ppqn;
		var startTime = opts ? opts.startTime : performance.now();
		var time = startTime;
		var ticks = 0;
		var adjustFirst = startAt > 0;
		
		for (var i=0; i<track.events.length; i++) {
			var event = track.events[i];
			if (event.type == 8 || event.type == 9 || (event.type == 255 && event.metaType == 47)) {
				ticks += event.deltaTime;
				if (adjustFirst)
					time += event.deltaTime * f;
				
				if (ticks < startAt)
					continue;					
				if (ticks >= justBefore)
					break;

				if (adjustFirst) {
					adjustFirst = false;
					time -= (ticks - startAt) * f;
				} else {
					time += event.deltaTime * f;
				}
				
				if (event.type == 8 || event.type == 9) {
					//console.log('[' + time + ' // ' +  ticks + '] Playing: ' + JSON.stringify(event));
					activeMidiOut.send([event.type == 8 ? 0x80 : 0x90, event.data[0], event.data[1]], time);
				}					
			}
		}
		
		return { 
			"t2tf": f,
			"startTime": startTime
		};
	}
	
	startPlayingPattern() {
		this.tempo = this.song.tempo;
		this.currentGroove = null;
		this.nextFill = null;
		
		console.log('Play pattern => ' + this.playingPattern);
		var pattern = this.song.patterns[this.playingPattern];
		this.tempo = pattern.tempo > 0 ? pattern.tempo : this.song.tempo;
		var groovesRepeatsValue = (pattern.name in this.groovesRepeats) ? this.groovesRepeats[pattern.name] : 0;
		var fillsRepeatsValue = (pattern.name in this.fillsRepeats) ? this.fillsRepeats[pattern.name] : 0; 
		
		var chosenGroove = pattern.groovesMode == 'sequence' ? groovesRepeatsValue % pattern.grooves.length : Math.floor(Math.random() * pattern.grooves.length);
		this.currentGroove = pattern.grooves[chosenGroove];
		if (pattern.fills.length > 0) {
			var chosenFill = pattern.fillsMode == 'sequence' ? fillsRepeatsValue % pattern.fills.length : Math.floor(Math.random() * pattern.fills.length);
			this.nextFill = pattern.fills[chosenFill];
		}
		
		var grooveNoFillSectionLength = this.nextFill ? (this.currentGroove.track.length - this.nextFill.track.length) : this.currentGroove.track.length;
		var data = this.playEvents(this.currentGroove.track, 0, grooveNoFillSectionLength + (this.nextFill ? 0 : 1));
		this.playingWhat = 'groove';
		
		this.groovesRepeats[pattern.name] = groovesRepeatsValue + 1; 
		this.callAfter(this.onAllEventsPlayed, grooveNoFillSectionLength * data.t2tf, data);
		
		this.firePlayStatusChanged();
	}
		
	onAllEventsPlayed(opts) {
		var lastPlayedWhat = this.playingWhat;
		this.playingWhat = null

		if (!activeMidiOut) {
			console.log('No active MIDI out port!');
			return;
		}

		if (lastPlayedWhat == 'groove') {
			var needToPlayFill = this.nextPattern && this.nextPattern != this.playingPattern;
			var fillAvailable = this.nextFill ? true : false;

			if (fillAvailable) {
				var fillSectionLengthInMillis = 0;
				if (needToPlayFill) {
					console.log('Playing the fill and into the next pattern');
					this.fillsRepeats[this.playingPattern] = (this.playingPattern in this.fillsRepeats) ? this.fillsRepeats[this.playingPattern] + 1 : 1; 
					var t2tf = this.playEvents(this.nextFill.track, 0, this.nextFill.track.length + 1).t2tf;
					this.playingWhat = 'fill';
					fillSectionLengthInMillis = this.nextFill.track.length * t2tf;
				} else  {
					console.log('No fill needed, play remaining of pattern');
					var t2tf = this.playEvents(this.currentGroove.track, 
						(this.currentGroove.track.length - this.nextFill.track.length), this.currentGroove.track.length + 1, opts).t2tf;
					this.playingWhat = 'remainder';
					fillSectionLengthInMillis = this.nextFill.track.length * t2tf;
				}
				this.callAfter(this.onAllEventsPlayed, fillSectionLengthInMillis);
				this.nextFill = null;
				
				this.firePlayStatusChanged();
				return;
			} 
			// else, if no fill is available, all of the current groove events have already been played.	
		} 

		if (this.nextPattern) {
			console.log('To next pattern => ' + this.nextPattern);
			
			this.playingPattern = this.nextPattern;
			this.nextPattern = null;
		} else if (this.playingPattern) {
			console.log('Repeat pattern => ' + this.playingPattern);
		}
		
		if (this.playingPattern)
			this.startPlayingPattern();
	}	
}


var activeMidiIn = null;
var activeMidiOut = null;
var song = new Song();
var orchestrator = null;

$(document).ready(function() {
	editMode();
	midiSetup();
	enableTestKeys();	
	loadSong();
});

function midiSetup() {
	navigator.requestMIDIAccess().then(function(access) {
		this.ma = access;

		const inputs = access.inputs.values();
		const outputs = access.outputs.values();

		const lastMidiIn = window.localStorage.getItem('midiIn');
		const lastMidiOut = window.localStorage.getItem('midiOut');

		Array.from(inputs).forEach(i => {
			var sel = document.getElementById('midiIns');
			var opt = document.createElement('option');
			opt.appendChild(document.createTextNode(i.name));
			opt.value = i.id; 
			if (i.id == lastMidiIn)
				opt.selected = 'selected';
			sel.appendChild(opt);
		});

		Array.from(outputs).forEach(o => {
			var sel = document.getElementById('midiOuts');
			var opt = document.createElement('option');
			opt.appendChild(document.createTextNode(o.name));
			opt.value = o.id; 
			if (o.id == lastMidiOut)
				opt.selected = 'selected';
			sel.appendChild(opt);	 
		});
		
		switchMidiIn();
		switchMidiOut();
	});
}	

function onPlayStatusChanged(e) {
	var currentlyPlayingPattern = $('#currentlyPlayingPattern');
	var nextPattern = $('#nextPattern');
	var currentlyPlayingPatternTempo = $('#currentlyPlayingPatternTempo');
	var nextPatternTempo = $('#nextPatternTempo');
	
	var currentPatternData = song.patterns[e.detail.currentPattern];
	var nextPatternData = song.patterns[e.detail.nextPattern];
	
	currentlyPlayingPattern.html(currentPatternData ? currentPatternData.name : 'NO PATTERN');
	currentlyPlayingPatternTempo.html('');
	nextPattern.html(nextPatternData ? '(Next: ' + nextPatternData.name + ')' : '');
	nextPatternTempo.html('');
}

function loadSong() {
	console.log(JSON.stringify(song, null, 2));

	orchestrator = new Orchestrator(song);
	orchestrator.addEventListener('playStatusChanged', onPlayStatusChanged);
		
	$('#songTitle').val(song.title);
	$('#songTempo').val(song.tempo);

	var patterns = $('#editingPattern');
	var patternGrooves = $('#editPatternGrooves');
	var patternFills = $('#editPatternFills');
	
	var savedPatternName = $("#editingPattern").val();
	
	patterns.empty();
	patternGrooves.empty();
	patternFills.empty();
	
	for (patternName in song.patterns) {
		var pattern = song.patterns[patternName];
		patterns.append($("<option />").val(pattern.name).text(pattern.name));
	}
	
	// TODO: Load actions
	
	if (savedPatternName && savedPatternName in song.patterns)
		patterns.val(savedPatternName);
	
	onSongPatternChange();
}

function onSongPatternChange() {
	var patternName = $('#editPatternName');
	var patternTempo = $('#editPatternTempo');
	var patternGroovesMode = $('#editPatternGroovesMode');
	var patternFillsMode = $('#editPatternFillsMode');
	var patternGrooves = $('#editPatternGrooves');
	var patternFills = $('#editPatternFills');
	
	patternName.val('');
	patternTempo.val(0);
	patternGroovesMode.val('sequence');
	patternFillsMode.val('sequence');
	patternGrooves.empty();
	patternFills.empty();
	
	var editingPatternName = $("#editingPattern").val();
	if (!editingPatternName)
		return;

	var pattern = song.patterns[editingPatternName];
	
	patternName.val(pattern.name);
	patternTempo.val(pattern.tempo);
	patternGroovesMode.val(pattern.groovesMode);
	patternFillsMode.val(pattern.fillsMode);

	for(var i=0; i<pattern.grooves.length; i++) {
		var groove = pattern.grooves[i];
		patternGrooves.append($("<option />").val(i).text(groove.name));		
	}

	for(var i=0; i<pattern.fills.length; i++) {
		var fill = pattern.fills[i];
		patternFills.append($("<option />").val(i).text(fill.name));		
	}
}

function switchMidiIn() {
	if (activeMidiIn) {
		activeMidiIn.close();
		activeMidiIn = null;
	}
	
	var portID = $('#midiIns').val();
	if (portID) {
		activeMidiIn = this.ma.inputs.get(portID);
		activeMidiIn.onmidimessage = onMidiMessage;
		activeMidiIn.open();
		window.localStorage.setItem('midiIn', activeMidiIn.id);
	}
}

function switchMidiOut() {
	if (activeMidiOut) {
		activeMidiOut = null;
	}
	
	var portID = $('#midiOuts').val();
	if (portID) {
		activeMidiOut = this.ma.outputs.get(portID);
		window.localStorage.setItem('midiOut', activeMidiOut.id);
	}
}

function onSongAttributeChange(name, value) {
	if (name == 'title') {
		if (song.title != value)
			song.title = value;
	} else if (name == 'tempo') {
		var newTempo = parseInt(value);
		if (newTempo > 0 && newTempo < 10000 && song.tempo != newTempo)
			song.tempo = newTempo;
	}	
}

function onPatternAttributeChange(name, value) {
	var selectedPatternName = $("#editingPattern").val();
	if (!selectedPatternName)
		return;
	
	var pattern = song.patterns[selectedPatternName];

	if (name == 'name') {
		if (song.renamePattern(pattern.name, value)) {
			var patterns = $('#editingPattern');
			patterns.empty();			
			for (patternName in song.patterns)
				patterns.append($("<option />").val(patternName).text(patternName));			
			patterns.val(value);
		}
	} else if (name == 'tempo') {
		var newTempo = parseInt(value);
		if (newTempo >= 0 && newTempo < 10000 && pattern.tempo != newTempo)
			pattern.tempo = newTempo;
	} else if (name == 'groovesMode') {
		pattern.groovesMode = value;
	} else if (name == 'fillsMode') {
		pattern.fillsMode = value;
	}	
}

function onMidiMessage(message) {	
	var midiMessage = parseMidiMessage(message)
	console.log('MIDI In=' + JSON.stringify(midiMessage, null, 2));
	if (midiMessage.velocity > 0) 
		onPedal(midiMessage.note-59);
}
  
function onPedal(pedal) {
	var patternName = Object.keys(song.patterns)[pedal - 1];
	orchestrator.playNext(patternName);
}
  
function parseMidiMessage(message) {
	return {
		command: message.data[0] >> 4,
		channel: message.data[0] & 0xf,
		note: message.data[1],
		velocity: message.data[2] / 127
	}
}

function loadSampleSong() {
	$.getJSON("etc/samples/song1.json", function(data) {
		song = data;
		loadSong();
	});
}

function editMode() {
	$('#editPanel').show();
	$('#playPanel').hide();
}

function playMode() {
	$('#editPanel').hide();
	$('#playPanel').show();
}
			
function createPattern() {
	song.createPattern();
	loadSong();
}

function deletePattern() {
	var selectedPatternName = $("#editingPattern").val();
	if (!selectedPatternName)
		return;

	song.deletePattern(selectedPatternName);
	loadSong();
}

function createPatternGroove() {
	var editingPatternName = $("#editingPattern").val();
	if (!editingPatternName)
		return;
	
	var inputFile = $('#openFile');
	var fn = function(e) {
		inputFile.off('change');

		var file = inputFile[0].files[0];

		if (file) {
			var reader = new FileReader();
			reader.onloadend = function () {
				song.patterns[editingPatternName].createGroove('embedded', file.name, reader.result);
				loadSong();
			};

			reader.readAsDataURL(file);	
		}
	};
	
	inputFile.change(fn);
	inputFile.click();
}


function createPatternFill() {
	var editingPatternName = $("#editingPattern").val();
	if (!editingPatternName)
		return;
	
	var inputFile = $('#openFile');
	var fn = function(e) {
		inputFile.off('change');

		var file = inputFile[0].files[0];

		if (file) {
			var reader = new FileReader();
			reader.onloadend = function () {
				song.patterns[editingPatternName].createFill('embedded', file.name, reader.result);
				loadSong();
			};

			reader.readAsDataURL(file);	
		}
	};
	
	inputFile.change(fn);
	inputFile.click();
}


function enableTestKeys() {
	$(document).keydown(function(e) { 		
		switch(e.keyCode) {
			case 90:
				onPedal(1);
				return
			case 88:
				onPedal(2);
				return
			case 67:
				onPedal(3);
				return
			case 86:
				onPedal(4);
				return
			case 66:
				onPedal(5);
				return
		}	
	});
}
