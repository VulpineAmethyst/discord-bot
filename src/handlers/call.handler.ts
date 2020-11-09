import Discord from 'discord.js';
import RodRequest from '../lib/rodRequest';
import RodResponse from '../lib/rodResponse';
import Handler from './handler';
import _ from 'lodash';
import Call from '../lib/call';


class CallHandler extends Handler {
	static callforCommands = ['call', 'callfor'];
	static addCommands = ['calladd', 'addtocall'];
	static doneCommands = ['calldone', 'endcall', 'callend'];
	static refreshCommands = ['callrefresh', 'refreshcall'];
	static logCommands = ['calllog'];

	static commands = _.union(
		CallHandler.callforCommands,
		CallHandler.doneCommands,
		CallHandler.logCommands,
		CallHandler.addCommands,
		CallHandler.refreshCommands
	);

	static async process(req: RodRequest, res: RodResponse): Promise<void> {
		const self = this;

		// are we in a DM?
		if (!req.channel.guild) return await res.sendSimple('This command does not work in direct messages.');

		// which command type did we get?
		if (CallHandler.callforCommands.includes(req.command)) return self.callfor(req, res);
		if (CallHandler.doneCommands.includes(req.command)) return self.done(req, res);
		if (CallHandler.logCommands.includes(req.command)) return self.log(req, res);
		if (CallHandler.addCommands.includes(req.command)) return self.add(req, res);
		if (CallHandler.refreshCommands.includes(req.command)) return self.refresh(req, res);
		
		
	}

	/**
	 * Grants access to an alias to set of users/roles
	 * @example `/callfor Iniative! You are attacked by Goblins, roll initiative! @party +Goblins`
	 * @param req
	 * @param res
	 */
	static async callfor(req: RodRequest, res: RodResponse): Promise<void> {

		// do we have permission?
		const perm = req.getPermissions();
		if (!perm) return await res.sendSimple('You do not have permission to start calls.');

		// check if there are any active calls
		if (Call.GetActiveCall( req )) {
			return await res.sendSimple('You already have an active call in this channel.', 'Ends calls with `' + req.server.esc + 'calldone`');
		}

		// parse
		const title = req.parts[0];
		const text = req.parts.slice(1).join(' ');

		// who was mentioned?
		let mentions = req.message.mentions.members.size ? _.map(req.message.mentions.members.array(), function (m) { return {id: m.id, name: m.displayName}; }) : [];

		// turn role members into members
		if (req.message.mentions.roles.size) {
			for (const role of req.message.mentions.roles.array()) {
				console.log('- checking role:', role.name);

				if (role.members.size) mentions = mentions.concat( _.map(role.members.array(), function (m) { return { id: m.id, name: m.displayName }; }) );
			}

			// might have double grabbed people from role
			mentions = _.uniq( mentions );
		}

		// any monster mentions? ex. `+Goblin`
		let npcs = [];
		for (let p of req.parts) {
			if (p.charAt(0) == '+') {
				p = p.slice(1);

				// remove quote if it's there
				if (p.charAt(0) == '"') p = p.slice(1);

				npcs.push( p );
			}
		}
		npcs = _.uniq(npcs );
		
		console.log('- found in call:', { mentions, npcs });

		// insert the call
		const call = new Call({
			channel: req.channel.id,
			name: title,
			text: text,
			start: new Date(),
			mentions: mentions,
			npcs: npcs
		});

		const em = call.generateEmbed( req );
		const message: Discord.Message = await res.sendSimple('', [em], {deleteCommand: true}); // we send a "simple" message rather than a webhooked one so we can edit it
		
		call.message = message.id;

		return call.save( req );
	}

	/**
	 * Adds mentioned users +NPCs to the active call
	 * @example `/calladd @Party +Goblin`
	 * @param req
	 * @param res
	 */
	static async add( req: RodRequest, res: RodResponse): Promise<void> {
		// is there an active call?
		const call = Call.GetActiveCall(req);
		if (!call) return await res.sendSimple('There is not currently a roll call active.');

		// do we have permission?
		const perm = req.getPermissions();
		if (!perm) return await res.sendSimple('You do not have permission to add mentions to calls.');

		// who was mentioned?
		let mentions = req.message.mentions.members.size ? _.map(req.message.mentions.members.array(), function (m) { return { id: m.id, name: m.displayName }; }) : [];

		// turn role members into members
		if (req.message.mentions.roles.size) {
			for (const role of req.message.mentions.roles.array()) {
				console.log('- checking role:', role.name);

				if (role.members.size) mentions = mentions.concat(_.map(role.members.array(), function (m) { return { id: m.id, name: m.displayName }; }));
			}

			// might have double grabbed people from role
			mentions = _.uniq(mentions);
		}

		// any monster mentions? ex. `+Goblin`
		let npcs = [];
		for (let p of req.parts) {
			if (p.charAt(0) == '+') {
				p = p.slice(1);

				// remove quote if it's there
				if (p.charAt(0) == '"') p = p.slice(1);

				npcs.push(p);
			}
		}
		npcs = _.uniq(npcs);

		console.log('- found in call add:', { mentions, npcs });

		call.mentions = call.mentions.concat( mentions );
		call.npcs = call.npcs.concat( npcs );

		call.save( req );

		// update the embed
		if (call.message) {
			const em = call.generateEmbed(req);

			const m = await req.channel.messages.fetch(call.message);
			await m.edit('', em);

			// delete the roll
			req.message.delete({ timeout: 500, reason: 'gobbled by rodbot call' });

			res.sent = true;
		}
	}

	/**
	 * Refreshes the call by posting it again and deleting the old one. Mostly just to move it down the chat.
	 * @param req
	 * @param res
	 */
	static async refresh( req: RodRequest, res: RodResponse ): Promise<void> {
		// is there an active call?
		const call = Call.GetActiveCall(req);
		if (!call) return await res.sendSimple('There is not currently a roll call active.');

		// do we have permission?
		const perm = req.getPermissions();
		if (!perm) return await res.sendSimple('You do not have permission to refresh calls.');

		// delete old post
		const m = await req.channel.messages.fetch(call.message);
		m.delete({timeout: 500, reason: 'rodbot: replaced by new call post'});

		// make new post
		const em = call.generateEmbed(req);
		const message: Discord.Message = await res.sendSimple('', [em], { deleteCommand: true }); // we send a "simple" message rather than a webhooked one so we can edit it

		call.message = message.id;

		return call.save(req);
	}

	/**
	 * Ends the current active call in the channel and prints the results
	 * @example `/calldone`
	 * @param req
	 * @param res
	 */
	static async done( req: RodRequest, res: RodResponse): Promise<void> {

		// is there an active call?
		const call = Call.GetActiveCall( req );
		if (!call) return await res.sendSimple('There is not currently a roll call active.');

		// do we have permission?
		const perm = req.getPermissions();
		if (!perm) return await res.sendSimple('You do not have permission to end calls.');

		await call.remove( req );

		let results = '**' + call.name + '** complete!\n\n';

		// add rolls
		_.each(_.sortBy(call.rolls, function (r) { return r.roll * -1; }), function (r) {
			results += '**' + r.name + '**: `' + r.roll + '`' + "\n";
		});

		return res.sendSimple('', results, {deleteCommand: true} );
	}

	/**
	 * Prints out the history of rolls for the active call
	 * @example `/calllog`
	 * @param req
	 * @param res
	 */
	static async log(req: RodRequest, res: RodResponse): Promise<void> {

		// is there an active call?
		const call = Call.GetActiveCall(req);
		if (!call) return await res.sendSimple('There is not currently a roll call active.');

		return res.sendSimple('', call.logs.join('\n'), {deleteCommand: true});
	}
}

export default CallHandler;
