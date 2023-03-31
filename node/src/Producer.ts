import { Logger } from './Logger';
import { EnhancedEventEmitter } from './EnhancedEventEmitter';
import { Channel } from './Channel';
import { PayloadChannel } from './PayloadChannel';
import { TransportInternal } from './Transport';
import { MediaKind, RtpParameters } from './RtpParameters';
import { AppData } from './types';

export type ProducerOptions<ProducerAppData extends AppData = AppData> =
{
	/**
	 * Producer id (just for Router.pipeToRouter() method).
	 */
	id?: string;

	/**
	 * Media kind ('audio' or 'video').
	 */
	kind: MediaKind;

	/**
	 * RTP parameters defining what the endpoint is sending.
	 */
	rtpParameters: RtpParameters;

	/**
	 * Whether the producer must start in paused mode. Default false.
	 */
	paused?: boolean;

	/**
	 * Just for video. Time (in ms) before asking the sender for a new key frame
	 * after having asked a previous one. Default 0.
	 */
	keyFrameRequestDelay?: number;

	/**
	 * Custom application data.
	 */
	appData?: ProducerAppData;
};

/**
 * Valid types for 'trace' event.
 */
export type ProducerTraceEventType = 'rtp' | 'keyframe' | 'nack' | 'pli' | 'fir';

/**
 * 'trace' event data.
 */
export type ProducerTraceEventData =
{
	/**
	 * Trace type.
	 */
	type: ProducerTraceEventType;

	/**
	 * Event timestamp.
	 */
	timestamp: number;

	/**
	 * Event direction.
	 */
	direction: 'in' | 'out';

	/**
	 * Per type information.
	 */
	info: any;
};

export type ProducerScore =
{
	/**
	 * SSRC of the RTP stream.
	 */
	ssrc: number;

	/**
	 * RID of the RTP stream.
	 */
	rid?: string;

	/**
	 * The score of the RTP stream.
	 */
	score: number;
};

export type ProducerVideoOrientation =
{
	/**
	 * Whether the source is a video camera.
	 */
	camera: boolean;

	/**
	 * Whether the video source is flipped.
	 */
	flip: boolean;

	/**
	 * Rotation degrees (0, 90, 180 or 270).
	 */
	rotation: number;
};

export type ProducerStat =
{
	// Common to all RtpStreams.
	type: string;
	timestamp: number;
	ssrc: number;
	rtxSsrc?: number;
	rid?: string;
	kind: string;
	mimeType: string;
	packetsLost: number;
	fractionLost: number;
	packetsDiscarded: number;
	packetsRetransmitted: number;
	packetsRepaired: number;
	nackCount: number;
	nackPacketCount: number;
	pliCount: number;
	firCount: number;
	score: number;
	packetCount: number;
	byteCount: number;
	bitrate: number;
	roundTripTime?: number;
	rtxPacketsDiscarded?: number;
	// RtpStreamRecv specific.
	jitter: number;
	bitrateByLayer?: any;
};

/**
 * Producer type.
 */
export type ProducerType = 'simple' | 'simulcast' | 'svc';

export type ProducerEvents =
{
	transportclose: [];
	score: [ProducerScore[]];
	videoorientationchange: [ProducerVideoOrientation];
	trace: [ProducerTraceEventData];
	// Private events.
	'@close': [];
};

export type ProducerObserverEvents =
{
	close: [];
	pause: [];
	resume: [];
	score: [ProducerScore[]];
	videoorientationchange: [ProducerVideoOrientation];
	trace: [ProducerTraceEventData];
};

type ProducerInternal = TransportInternal &
{
	producerId: string;
};

type ProducerData =
{
	kind: MediaKind;
	rtpParameters: RtpParameters;
	type: ProducerType;
	consumableRtpParameters: RtpParameters;
};

const logger = new Logger('Producer');

export class Producer<ProducerAppData extends AppData = AppData>
	extends EnhancedEventEmitter<ProducerEvents>
{
	// Internal data.
	readonly #internal: ProducerInternal;

	// Producer data.
	readonly #data: ProducerData;

	// Channel instance.
	readonly #channel: Channel;

	// PayloadChannel instance.
	readonly #payloadChannel: PayloadChannel;

	// Closed flag.
	#closed = false;

	// Custom app data.
	#appData: ProducerAppData;

	// Paused flag.
	#paused = false;

	// Current score.
	#score: ProducerScore[] = [];

	// Observer instance.
	readonly #observer = new EnhancedEventEmitter<ProducerObserverEvents>();

	/**
	 * @private
	 */
	constructor(
		{
			internal,
			data,
			channel,
			payloadChannel,
			appData,
			paused
		}:
		{
			internal: ProducerInternal;
			data: ProducerData;
			channel: Channel;
			payloadChannel: PayloadChannel;
			appData?: ProducerAppData;
			paused: boolean;
		}
	)
	{
		super();

		logger.debug('constructor()');

		this.#internal = internal;
		this.#data = data;
		this.#channel = channel;
		this.#payloadChannel = payloadChannel;
		this.#appData = appData || {} as ProducerAppData;
		this.#paused = paused;

		this.handleWorkerNotifications();
	}

	/**
	 * Producer id.
	 */
	get id(): string
	{
		return this.#internal.producerId;
	}

	/**
	 * Whether the Producer is closed.
	 */
	get closed(): boolean
	{
		return this.#closed;
	}

	/**
	 * Media kind.
	 */
	get kind(): MediaKind
	{
		return this.#data.kind;
	}

	/**
	 * RTP parameters.
	 */
	get rtpParameters(): RtpParameters
	{
		return this.#data.rtpParameters;
	}

	/**
	 * Producer type.
	 */
	get type(): ProducerType
	{
		return this.#data.type;
	}

	/**
	 * Consumable RTP parameters.
	 *
	 * @private
	 */
	get consumableRtpParameters(): RtpParameters
	{
		return this.#data.consumableRtpParameters;
	}

	/**
	 * Whether the Producer is paused.
	 */
	get paused(): boolean
	{
		return this.#paused;
	}

	/**
	 * Producer score list.
	 */
	get score(): ProducerScore[]
	{
		return this.#score;
	}

	/**
	 * App custom data.
	 */
	get appData(): ProducerAppData
	{
		return this.#appData;
	}

	/**
	 * App custom data setter.
	 */
	set appData(appData: ProducerAppData)
	{
		this.#appData = appData;
	}

	/**
	 * Observer.
	 */
	get observer(): EnhancedEventEmitter<ProducerObserverEvents>
	{
		return this.#observer;
	}

	/**
	 * @private
	 * Just for testing purposes.
	 */
	get channelForTesting(): Channel
	{
		return this.#channel;
	}

	/**
	 * Close the Producer.
	 */
	close(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('close()');

		this.#closed = true;

		// Remove notification subscriptions.
		this.#channel.removeAllListeners(this.#internal.producerId);
		this.#payloadChannel.removeAllListeners(this.#internal.producerId);

		const reqData = { producerId: this.#internal.producerId };

		this.#channel.request('transport.closeProducer', this.#internal.transportId, reqData)
			.catch(() => {});

		this.emit('@close');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Transport was closed.
	 *
	 * @private
	 */
	transportClosed(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('transportClosed()');

		this.#closed = true;

		// Remove notification subscriptions.
		this.#channel.removeAllListeners(this.#internal.producerId);
		this.#payloadChannel.removeAllListeners(this.#internal.producerId);

		this.safeEmit('transportclose');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Dump Producer.
	 */
	async dump(): Promise<any>
	{
		logger.debug('dump()');

		return this.#channel.request('producer.dump', this.#internal.producerId);
	}

	/**
	 * Get Producer stats.
	 */
	async getStats(): Promise<ProducerStat[]>
	{
		logger.debug('getStats()');

		return this.#channel.request('producer.getStats', this.#internal.producerId);
	}

	/**
	 * Pause the Producer.
	 */
	async pause(): Promise<void>
	{
		logger.debug('pause()');

		const wasPaused = this.#paused;

		await this.#channel.request('producer.pause', this.#internal.producerId);

		this.#paused = true;

		// Emit observer event.
		if (!wasPaused)
		{
			this.#observer.safeEmit('pause');
		}
	}

	/**
	 * Resume the Producer.
	 */
	async resume(): Promise<void>
	{
		logger.debug('resume()');

		const wasPaused = this.#paused;

		await this.#channel.request('producer.resume', this.#internal.producerId);

		this.#paused = false;

		// Emit observer event.
		if (wasPaused)
		{
			this.#observer.safeEmit('resume');
		}
	}

	/**
	 * Enable 'trace' event.
	 */
	async enableTraceEvent(types: ProducerTraceEventType[] = []): Promise<void>
	{
		logger.debug('enableTraceEvent()');

		const reqData = { types };

		await this.#channel.request(
			'producer.enableTraceEvent', this.#internal.producerId, reqData);
	}

	/**
	 * Send RTP packet (just valid for Producers created on a DirectTransport).
	 */
	send(rtpPacket: Buffer)
	{
		if (!Buffer.isBuffer(rtpPacket))
		{
			throw new TypeError('rtpPacket must be a Buffer');
		}

		this.#payloadChannel.notify(
			'producer.send', this.#internal.producerId, undefined, rtpPacket);
	}

	private handleWorkerNotifications(): void
	{
		this.#channel.on(this.#internal.producerId, (event: string, data?: any) =>
		{
			switch (event)
			{
				case 'score':
				{
					const score = data as ProducerScore[];

					this.#score = score;

					this.safeEmit('score', score);

					// Emit observer event.
					this.#observer.safeEmit('score', score);

					break;
				}

				case 'videoorientationchange':
				{
					const videoOrientation = data as ProducerVideoOrientation;

					this.safeEmit('videoorientationchange', videoOrientation);

					// Emit observer event.
					this.#observer.safeEmit('videoorientationchange', videoOrientation);

					break;
				}

				case 'trace':
				{
					const trace = data as ProducerTraceEventData;

					this.safeEmit('trace', trace);

					// Emit observer event.
					this.#observer.safeEmit('trace', trace);

					break;
				}

				default:
				{
					logger.error('ignoring unknown event "%s"', event);
				}
			}
		});
	}
}
