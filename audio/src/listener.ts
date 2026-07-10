import { Unit2D, type Unit, type Unit2DProps } from "@mise/core";
import { AudioMixer } from "./mixer.ts";

export interface AudioListener2DProps extends Unit2DProps {}

/**
 * An explicit ears-position for positional audio. While one is in the tree,
 * its nearest `AudioMixer` ancestor hears from this unit's world position
 * instead of following the active camera — parent it to the player character
 * to hear from the character rather than a smoothed or offset camera view.
 *
 * Claims the mixer's listener slot on tree enter and releases it on exit
 * (the most recent one to enter wins). Throws on tree enter without an
 * `AudioMixer` ancestor.
 */
export class AudioListener2D<
  P extends AudioListener2DProps = AudioListener2DProps,
> extends Unit2D<P> {
  private mixer: AudioMixer | null = null;

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const mixer = this.findAncestor(AudioMixer);
    if (!mixer) {
      throw new Error("AudioListener2D must be a descendant of an AudioMixer");
    }
    this.mixer = mixer;
    mixer.setListener(this);
  }

  override onTreeExit(parent: Unit | null): void {
    this.mixer?.clearListener(this);
    this.mixer = null;
    super.onTreeExit(parent);
  }
}
